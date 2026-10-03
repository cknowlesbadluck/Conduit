/**
 * Public-host identity for Resonance.
 *
 * A green GitHub deployment against a Vercel alias is not the public gate.
 * Only resonancenexus.netlify.app can close the ready contract.
 */

export const PUBLIC_RESONANCE_HOST = "resonancenexus.netlify.app";
export const EXPECTED_RESONANCE_CONTRACT = "2026-10-03-owner-gate";

export type HostClass = "public_gate" | "alias" | "invalid";

export type ReadyClass = "ready" | "owner_blocked" | "deploy_lag" | "wrong_host" | "down";

export function classifyHost(url: string): HostClass {
  try {
    const host = new URL(url).hostname;
    if (host === PUBLIC_RESONANCE_HOST) return "public_gate";
    return "alias";
  } catch {
    return "invalid";
  }
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
}): ReadyClass {
  const host = classifyHost(input.url);
  if (host !== "public_gate") return "wrong_host";

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
