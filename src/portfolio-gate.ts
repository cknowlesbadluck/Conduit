/**
 * Portfolio gate classifier.
 *
 * Turns already-fetched host probes into one verdict. It does not call the
 * network, invent secrets, or treat a unit test as production proof.
 * Quicksilver has no public readiness host; device HG stays an owner gate.
 */

export const CONDUIT_EXPECTED_VERSION = "0.8.0";
export const CONDUIT_EXPECTED_REVISION = "2026-10-03-ready-surface";
export const RESONANCE_OWNER_KEY = "SUPABASE_SERVICE_ROLE_KEY";

export type Probe = {
  httpStatus: number;
  body: unknown;
};

export type PortfolioProbes = {
  conduitHealth: Probe;
  conduitReady: Probe;
  resonanceReady: Probe;
};

export type HostVerdict =
  | "ready"
  | "owner_blocked"
  | "surface_split"
  | "deploy_lag"
  | "down"
  | "malformed"
  | "unexpected";

export type PortfolioVerdict = {
  conduit: HostVerdict;
  resonance: HostVerdict;
  quicksilver: "device_gate";
  portfolio: "open" | "blocked_owner" | "blocked_conduit" | "blocked_resonance";
  deployLag: boolean;
  ownerActionRequiredFieldPresent: boolean;
  ownerAction: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function missingKeys(body: Record<string, unknown>): string[] | null {
  const raw = body.missingRequired;
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) return null;
  return [...raw];
}

export function classifyConduit(health: Probe, ready: Probe): HostVerdict {
  if (health.httpStatus >= 500 || ready.httpStatus >= 500) return "down";
  if (health.httpStatus !== 200 || ready.httpStatus !== 200) return "unexpected";
  if (!isRecord(health.body) || !isRecord(ready.body)) return "malformed";

  const healthRevision = health.body.contractRevision;
  const readyRevision = ready.body.contractRevision;
  const healthVersion = health.body.version;
  const readyVersion = ready.body.version;

  if (typeof healthRevision !== "string" || typeof readyRevision !== "string") return "surface_split";
  if (healthRevision !== readyRevision) return "surface_split";
  if (typeof healthVersion !== "string" || typeof readyVersion !== "string") return "surface_split";
  if (healthVersion !== readyVersion) return "surface_split";
  if (healthVersion !== CONDUIT_EXPECTED_VERSION) return "deploy_lag";
  if (healthRevision !== CONDUIT_EXPECTED_REVISION) return "deploy_lag";
  if (ready.body.status !== "ready" || ready.body.persistence !== "postgres") return "unexpected";
  if (health.body.status !== "ok" || health.body.service !== "conduit") return "unexpected";
  return "ready";
}

export function classifyResonance(probe: Probe): {
  verdict: HostVerdict;
  deployLag: boolean;
  ownerActionRequiredFieldPresent: boolean;
} {
  if (probe.httpStatus >= 500 && probe.httpStatus !== 503) {
    return { verdict: "down", deployLag: false, ownerActionRequiredFieldPresent: false };
  }
  if (!isRecord(probe.body)) {
    return { verdict: "malformed", deployLag: false, ownerActionRequiredFieldPresent: false };
  }
  const ownerFieldPresent = Object.prototype.hasOwnProperty.call(probe.body, "ownerActionRequired");
  const deployLag = !Object.prototype.hasOwnProperty.call(probe.body, "contractRevision");
  const missing = missingKeys(probe.body);

  if (probe.httpStatus === 200 && probe.body.status === "ready") {
    return { verdict: "ready", deployLag, ownerActionRequiredFieldPresent: ownerFieldPresent };
  }

  const exactOwnerBlock =
    probe.httpStatus === 503 &&
    probe.body.status === "not_ready" &&
    missing !== null &&
    missing.length === 1 &&
    missing[0] === RESONANCE_OWNER_KEY;

  if (exactOwnerBlock) {
    return { verdict: "owner_blocked", deployLag, ownerActionRequiredFieldPresent: ownerFieldPresent };
  }
  if (probe.httpStatus === 503) return { verdict: "unexpected", deployLag, ownerActionRequiredFieldPresent: ownerFieldPresent };
  return { verdict: "unexpected", deployLag, ownerActionRequiredFieldPresent: ownerFieldPresent };
}

export function classifyPortfolioGate(input: PortfolioProbes): PortfolioVerdict {
  const conduit = classifyConduit(input.conduitHealth, input.conduitReady);
  const resonance = classifyResonance(input.resonanceReady);
  let portfolio: PortfolioVerdict["portfolio"] = "open";
  let ownerAction: string | null = null;

  if (resonance.verdict === "owner_blocked") {
    portfolio = "blocked_owner";
    ownerAction = `Set ${RESONANCE_OWNER_KEY} on Netlify site resonancenexus only. Do not invent it.`;
  } else if (conduit !== "ready") {
    portfolio = "blocked_conduit";
  } else if (resonance.verdict !== "ready") {
    portfolio = "blocked_resonance";
  }

  return {
    conduit,
    resonance: resonance.verdict,
    quicksilver: "device_gate",
    portfolio,
    deployLag: resonance.deployLag,
    ownerActionRequiredFieldPresent: resonance.ownerActionRequiredFieldPresent,
    ownerAction,
  };
}
