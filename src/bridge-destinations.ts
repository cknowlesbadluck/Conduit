import { createHash } from "node:crypto";
import { isIP } from "node:net";

/**
 * Destination rule for `mcp_bridge_call`.
 *
 * The bridge endpoint comes from tool input. Independently of the SSRF guard in
 * mcp-bridge.ts (HTTPS only, private/loopback targets refused, DNS pinned) and of
 * capability grants, this module decides whether a destination is *known*:
 *
 *   - it matches the env allowlist `CONDUIT_BRIDGE_ALLOWED_DESTINATIONS`, or
 *   - its origin matches the endpoint of a registered (non-archived) tool or resource.
 *
 * Modes (`CONDUIT_BRIDGE_DESTINATION_MODE`):
 *   - `report` (default): allow the call, but log and count the violation with a redacted host.
 *   - `enforce`: refuse unknown destinations with `mcp_endpoint_not_allowlisted`.
 *   - `off`: skip the check entirely (no lookup, no counting).
 * Unknown values fall back to `report` so a typo can never start refusing traffic.
 */
export type BridgeDestinationMode = "report" | "enforce" | "off";

export type AllowlistEntry =
  | { kind: "origin"; origin: string }
  | { kind: "host"; host: string }
  | { kind: "subdomain"; suffix: string };

export type BridgeDestinationDecision = {
  mode: BridgeDestinationMode;
  allowed: boolean;
  matched: "allowlist" | "registered" | null;
  violation: boolean;
};

export type RegisteredEndpointSource = () => Promise<string[]>;

const MODE_ENV = "CONDUIT_BRIDGE_DESTINATION_MODE";
const ALLOWLIST_ENV = "CONDUIT_BRIDGE_ALLOWED_DESTINATIONS";
const MAX_ENTRIES = 200;
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

let violations = 0;
let lastViolationAt: string | null = null;

export function bridgeDestinationMode(env: NodeJS.ProcessEnv = process.env): { mode: BridgeDestinationMode; valid: boolean } {
  const raw = env[MODE_ENV]?.trim().toLowerCase();
  if (!raw) return { mode: "report", valid: true };
  if (raw === "report" || raw === "enforce" || raw === "off") return { mode: raw, valid: true };
  return { mode: "report", valid: false };
}

function validHostname(host: string): boolean {
  if (isIP(host.replace(/^\[|\]$/g, ""))) return true;
  if (host.length > 253) return false;
  return host.split(".").every((label) => HOST_LABEL.test(label));
}

/** Parse one allowlist entry. Returns null for anything that is not an exact origin, exact host, or leading `*.` subdomain rule. */
export function parseAllowlistEntry(raw: string): AllowlistEntry | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("://")) {
    if (value.includes("*")) return null;
    let url: URL;
    try { url = new URL(value); } catch { return null; }
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
    return { kind: "origin", origin: url.origin };
  }
  if (value.startsWith("*.")) {
    const suffix = value.slice(2);
    if (suffix.includes("*") || !suffix.includes(".") || !validHostname(suffix) || isIP(suffix)) return null;
    return { kind: "subdomain", suffix };
  }
  if (value.includes("*") || value.includes("/") || value.includes(":") && !value.startsWith("[")) return null;
  if (!validHostname(value)) return null;
  return { kind: "host", host: value };
}

export function parseAllowlist(raw: string | undefined): { entries: AllowlistEntry[]; invalid: number } {
  const entries: AllowlistEntry[] = [];
  let invalid = 0;
  for (const part of (raw ?? "").split(",")) {
    if (!part.trim()) continue;
    const entry = entries.length < MAX_ENTRIES ? parseAllowlistEntry(part) : null;
    if (entry) entries.push(entry);
    else invalid += 1;
  }
  return { entries, invalid };
}

export function matchesAllowlistEntry(url: URL, entry: AllowlistEntry): boolean {
  const host = url.hostname.toLowerCase();
  if (entry.kind === "origin") return url.origin.toLowerCase() === entry.origin;
  if (entry.kind === "host") return host === entry.host;
  return host.endsWith(`.${entry.suffix}`) && host.length > entry.suffix.length + 1;
}

/** True when `url` has the same origin as any registered endpoint (exact origin, never a prefix or host-only match). */
export function matchesRegisteredEndpoint(url: URL, registered: string[]): boolean {
  const origin = url.origin.toLowerCase();
  for (const endpoint of registered) {
    try {
      const candidate = new URL(endpoint);
      if (candidate.protocol === "https:" && candidate.origin.toLowerCase() === origin) return true;
    } catch { /* ignore malformed registered endpoints */ }
  }
  return false;
}

/** Redact a host for logs: keep the last two labels, replace the rest, and add a short stable hash for correlation. */
export function redactHost(host: string): string {
  const lower = host.toLowerCase();
  const tag = createHash("sha256").update(lower).digest("hex").slice(0, 8);
  if (isIP(lower.replace(/^\[|\]$/g, ""))) return `ip-literal#${tag}`;
  const labels = lower.split(".");
  const shown = labels.length > 2 ? `*.${labels.slice(-2).join(".")}` : lower;
  return `${shown}#${tag}`;
}

export async function checkBridgeDestination(
  endpoint: URL,
  registeredEndpoints: RegisteredEndpointSource,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BridgeDestinationDecision> {
  const { mode } = bridgeDestinationMode(env);
  if (mode === "off") return { mode, allowed: true, matched: null, violation: false };
  const { entries } = parseAllowlist(env[ALLOWLIST_ENV]);
  if (entries.some((entry) => matchesAllowlistEntry(endpoint, entry))) return { mode, allowed: true, matched: "allowlist", violation: false };
  let registered: string[] = [];
  try {
    registered = await registeredEndpoints();
  } catch {
    // Lookup failure: report mode still allows; enforce mode fails closed below.
    registered = [];
  }
  if (matchesRegisteredEndpoint(endpoint, registered)) return { mode, allowed: true, matched: "registered", violation: false };
  violations += 1;
  lastViolationAt = new Date().toISOString();
  return { mode, allowed: mode !== "enforce", matched: null, violation: true };
}

export function bridgeDestinationStatus(env: NodeJS.ProcessEnv = process.env) {
  const { mode, valid } = bridgeDestinationMode(env);
  const { entries, invalid } = parseAllowlist(env[ALLOWLIST_ENV]);
  return { mode, modeValid: valid, allowlistEntries: entries.length, invalidAllowlistEntries: invalid, violations, lastViolationAt };
}

/** Test hook. */
export function resetBridgeDestinationStatsForTests() {
  violations = 0;
  lastViolationAt = null;
}
