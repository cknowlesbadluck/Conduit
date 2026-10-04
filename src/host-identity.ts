/**
 * Public-host identity for Resonance.
 *
 * A green GitHub deployment against a Vercel alias is not the public gate.
 * A 302 into Vercel SSO is not a 200. Only resonancenexus.netlify.app can
 * close the ready contract.
 */

export const PUBLIC_RESONANCE_HOST = "resonancenexus.netlify.app";
export const EXPECTED_RESONANCE_CONTRACT = "2026-10-03-owner-gate";

export type HostClass = "public_gate" | "alias" | "invalid";

export type ReadyClass = "ready" | "owner_blocked" | "deploy_lag" | "wrong_host" | "down";

export type ProbeTransport = {
  url: string;
  status: number;
  location?: string;
  body: string;
};

export type ParsedProbe = {
  hostClass: HostClass;
  readyClass: ReadyClass;
  ssoChallenge: boolean;
  json: boolean;
  missingRequired: string[];
  contractRevision?: string;
  hasOwnerActionRequired: boolean;
};

export function classifyHost(url: string): HostClass {
  try {
    const host = new URL(url).hostname;
    if (host === PUBLIC_RESONANCE_HOST) return "public_gate";
    return "alias";
  } catch {
    return "invalid";
  }
}

export function isSsoChallenge(input: { status: number; location?: string; body: string }): boolean {
  const location = input.location ?? "";
  if (input.status >= 300 && input.status < 400 && location.includes("vercel.com/sso")) return true;
  return input.body.includes("Protected by Vercel Authentication");
}

/**
 * Classify a Resonance ready probe.
 * Owner secret missing outranks contract omission.
 * A non-public host is never proof, even on HTTP 200.
 */
export function classifyResonanceReady(input: {
  url: string;
  status: number;
  missingRequired?: string[];
  hasOwnerActionRequired: boolean;
  contractRevision?: string;
  expectedContractRevision?: string;
  ssoChallenge?: boolean;
}): ReadyClass {
  const host = classifyHost(input.url);
  if (host !== "public_gate" || input.ssoChallenge) return "wrong_host";

  const missing = input.missingRequired ?? [];
  if (missing.includes("SUPABASE_SERVICE_ROLE_KEY")) return "owner_blocked";

  const expected = input.expectedContractRevision ?? EXPECTED_RESONANCE_CONTRACT;
  const contractOk = input.contractRevision === expected;
  const ready = input.status === 200
    && input.hasOwnerActionRequired === false
    && contractOk
    && missing.length === 0;
  if (ready) return "ready";

  if (input.status === 200 || input.status === 503) return "deploy_lag";
  return "down";
}

/** Parse a raw probe. Non-JSON and SSO redirects never become ready. */
export function parseReadyProbe(input: ProbeTransport): ParsedProbe {
  const hostClass = classifyHost(input.url);
  const ssoChallenge = isSsoChallenge(input);
  let json = false;
  let missingRequired: string[] = [];
  let contractRevision: string | undefined;
  let hasOwnerActionRequired = false;
  let ownerFieldPresent = false;

  try {
    const parsed = JSON.parse(input.body) as {
      missingRequired?: unknown;
      contractRevision?: unknown;
      ownerActionRequired?: unknown;
    };
    json = true;
    if (Array.isArray(parsed.missingRequired)) {
      missingRequired = parsed.missingRequired.filter((item): item is string => typeof item === "string");
    }
    if (typeof parsed.contractRevision === "string") contractRevision = parsed.contractRevision;
    if (typeof parsed.ownerActionRequired === "boolean") {
      ownerFieldPresent = true;
      hasOwnerActionRequired = parsed.ownerActionRequired;
    }
  } catch {
    json = false;
  }

  const readyClass = classifyResonanceReady({
    url: input.url,
    status: input.status,
    missingRequired,
    hasOwnerActionRequired: ownerFieldPresent ? hasOwnerActionRequired : false,
    contractRevision,
    ssoChallenge,
  });

  return {
    hostClass,
    readyClass,
    ssoChallenge,
    json,
    missingRequired,
    contractRevision,
    hasOwnerActionRequired: ownerFieldPresent ? hasOwnerActionRequired : false,
  };
}
