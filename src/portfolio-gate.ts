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
export const PROBE_MAX_AGE_MS = 90 * 60 * 1000;

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
  quicksilver: "device_gate" | "device_observed";
  portfolio: "open" | "blocked_owner" | "blocked_conduit" | "blocked_resonance";
  deployLag: boolean;
  ownerActionRequiredFieldPresent: boolean;
  ownerAction: string | null;
  witness: "fresh" | "stale" | "undated";
};

export type EntropyInput = {
  openRoadmapPullRequests: number;
  legacyRepoArchived: boolean;
  deviceHgObserved: boolean;
  simulatorGreen: boolean;
  redRequiredCiOpen: boolean;
};

export type ActionSplit = {
  ownerActions: string[];
  agentActions: string[];
  nonProof: string[];
  portfolio: PortfolioVerdict["portfolio"];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function missingKeys(body: Record<string, unknown>): string[] | null {
  const raw = body.missingRequired;
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) return null;
  return [...raw];
}

export function classifyProbeFreshness(
  body: unknown,
  observedAtIso: string,
  maxAgeMs = PROBE_MAX_AGE_MS,
): "fresh" | "stale" | "undated" {
  if (!isRecord(body) || typeof body.timestamp !== "string") return "undated";
  const observed = Date.parse(observedAtIso);
  const stamped = Date.parse(body.timestamp);
  if (!Number.isFinite(observed) || !Number.isFinite(stamped)) return "undated";
  const age = observed - stamped;
  if (age < 0 || age > maxAgeMs) return "stale";
  return "fresh";
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

export function classifyPortfolioGate(
  input: PortfolioProbes,
  deviceHgObserved = false,
  observedAtIso?: string,
): PortfolioVerdict {
  const conduit = classifyConduit(input.conduitHealth, input.conduitReady);
  const resonance = classifyResonance(input.resonanceReady);
  const witness = observedAtIso
    ? classifyProbeFreshness(input.resonanceReady.body, observedAtIso)
    : "undated";
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

  if (witness === "stale" && portfolio === "open") {
    portfolio = "blocked_resonance";
  }

  return {
    conduit,
    resonance: resonance.verdict,
    quicksilver: deviceHgObserved ? "device_observed" : "device_gate",
    portfolio,
    deployLag: resonance.deployLag,
    ownerActionRequiredFieldPresent: resonance.ownerActionRequiredFieldPresent,
    ownerAction,
    witness,
  };
}

export function splitPortfolioActions(verdict: PortfolioVerdict, entropy: EntropyInput): ActionSplit {
  const ownerActions: string[] = [];
  const agentActions: string[] = [];
  const nonProof: string[] = [
    "A classifier unit test is not production proof.",
    "A GitHub deployment status is not the public ready body.",
  ];

  if (verdict.ownerAction) ownerActions.push(verdict.ownerAction);
  if (!entropy.legacyRepoArchived) {
    ownerActions.push("Archive cknowlesbadluck/Quicksilver from the owner account. Agent archive returns 403.");
  }
  if (!entropy.deviceHgObserved) {
    ownerActions.push("Run CHR-55 archive IPA on iPhone 16e. This host cannot observe that gate.");
  }
  if (entropy.simulatorGreen || verdict.quicksilver !== "device_observed") {
    nonProof.push("Simulator CI is not device HG.");
  }
  if (entropy.openRoadmapPullRequests > 0) {
    nonProof.push("An open roadmap pull request is not production proof.");
  }
  if (verdict.witness === "stale") {
    agentActions.push("A stale probe timestamp is not a current witness. Re-probe before claiming the gate.");
  }
  if (verdict.witness === "undated") {
    nonProof.push("An undated probe is not a freshness witness.");
  }
  if (verdict.deployLag) {
    agentActions.push("Do not treat a preview deploy as the public host.");
  }
  if (entropy.redRequiredCiOpen) {
    agentActions.push("Do not merge red required CI.");
  }
  agentActions.push(`Do not invent ${RESONANCE_OWNER_KEY}.`);
  if (entropy.openRoadmapPullRequests > 1) {
    agentActions.push("Refresh the existing roadmap pull request in place. Do not open another.");
  }

  return {
    ownerActions,
    agentActions,
    nonProof,
    portfolio: verdict.portfolio,
  };
}
