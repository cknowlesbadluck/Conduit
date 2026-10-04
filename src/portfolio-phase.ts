/**
 * Project-agnostic portfolio phase machine.
 * Callers pass probe facts. This module does not know which product it is scoring
 * and never accepts or emits secret values — only missing key names.
 */

export const PORTFOLIO_PHASES = [
  { id: 0, name: "inventory", exit: "Repo or service identity exists and is named." },
  { id: 1, name: "liveness", exit: "Health probe is HTTP 200." },
  { id: 2, name: "readiness", exit: "Ready probe is HTTP 200 and names no missing required config." },
  { id: 3, name: "contract_parity", exit: "Live contract revision matches the expected stamp when one is required." },
  { id: 4, name: "hygiene", exit: "No orphan branches. Keep-red pull requests stay unmerged." },
  { id: 5, name: "owner_gate", exit: "No owner-only gate remains (secret, device, archive)." },
  { id: 6, name: "ci_green", exit: "Required CI on the candidate is green." },
  { id: 7, name: "merged_slice", exit: "The candidate slice is merged." },
  { id: 8, name: "proof", exit: "Production or device proof is recorded." },
  { id: 9, name: "steady", exit: "No open blocker. Retired projects land here only when archived." },
] as const;

export type PortfolioPhaseId = (typeof PORTFOLIO_PHASES)[number]["id"];

export type ProbeSnapshot = {
  id: string;
  archived?: boolean;
  healthStatus?: number;
  readyStatus?: number;
  contractRevision?: string | null;
  expectedContractRevision?: string | null;
  missingRequired?: string[];
  ownerGates?: string[];
  orphanBranches?: number;
  keepRedOpen?: number;
  requiredCiGreen?: boolean;
  candidateMerged?: boolean;
  proofRecorded?: boolean;
};

export type PhaseVerdict = {
  id: string;
  satisfiedPhase: PortfolioPhaseId;
  blockedAt: PortfolioPhaseId | null;
  phaseName: string;
  ownerActions: string[];
  agentActions: string[];
  doNotMerge: boolean;
  secretsInvented: false;
};

const KEY_NAME = /^[A-Z][A-Z0-9_]{2,80}$/;

function keyNames(names: string[] | undefined): string[] {
  return (names ?? []).filter((name) => KEY_NAME.test(name));
}

function phaseName(id: PortfolioPhaseId): string {
  return PORTFOLIO_PHASES[id].name;
}

/**
 * Highest satisfied phase, plus the single next blocker.
 * A 503 that names a missing key is an owner gate, not an agent task.
 * Keep-red pull requests force doNotMerge even when later phases are otherwise clean.
 */
export function classifyPortfolioPhase(snapshot: ProbeSnapshot): PhaseVerdict {
  const missing = keyNames(snapshot.missingRequired);
  const gates = (snapshot.ownerGates ?? []).filter((gate) => gate.trim().length > 0);
  const orphans = snapshot.orphanBranches ?? 0;
  const keepRed = snapshot.keepRedOpen ?? 0;
  const ownerActions: string[] = [];
  const agentActions: string[] = [];

  if (snapshot.archived) {
    return {
      id: snapshot.id,
      satisfiedPhase: 9,
      blockedAt: null,
      phaseName: phaseName(9),
      ownerActions: [],
      agentActions: [],
      doNotMerge: false,
      secretsInvented: false,
    };
  }

  let satisfied: PortfolioPhaseId = 0;
  let blockedAt: PortfolioPhaseId | null = 1;

  if (snapshot.healthStatus === 200) {
    satisfied = 1;
    blockedAt = 2;
  } else {
    agentActions.push("probe liveness; do not treat a missing health body as ready");
  }

  const ready = snapshot.readyStatus === 200 && missing.length === 0;
  if (satisfied === 1 && ready) {
    satisfied = 2;
    blockedAt = 3;
  } else if (satisfied === 1 && missing.length > 0) {
    ownerActions.push(`set required config by name only: ${missing.join(", ")}`);
    agentActions.push("do not invent secret values; a 503 naming missing keys is not an implementation task");
  } else if (satisfied === 1) {
    agentActions.push("ready probe is not 200 and named no missing key; inspect the ready contract");
  }

  const expected = snapshot.expectedContractRevision;
  const live = snapshot.contractRevision;
  const parity = expected == null || expected === "" || (typeof live === "string" && live === expected);
  if (satisfied === 2 && parity) {
    satisfied = 3;
    blockedAt = 4;
  } else if (satisfied === 2) {
    agentActions.push("contract revision missing or mismatched; do not call the surface aligned");
  }

  if (satisfied === 3 && orphans === 0) {
    satisfied = 4;
    blockedAt = 5;
  } else if (satisfied === 3 && orphans > 0) {
    agentActions.push(`open or delete ${orphans} orphan branch(es); do not leave committed work without a pull request`);
  }
  if (keepRed > 0) {
    agentActions.push(`leave ${keepRed} keep-red pull request(s) unmerged`);
  }

  if (satisfied === 4 && gates.length === 0 && missing.length === 0) {
    satisfied = 5;
    blockedAt = 6;
  } else if (satisfied === 4 && (gates.length > 0 || missing.length > 0)) {
    for (const gate of gates) ownerActions.push(gate);
  }

  if (satisfied === 5 && snapshot.requiredCiGreen === true) {
    satisfied = 6;
    blockedAt = 7;
  } else if (satisfied === 5) {
    agentActions.push("do not merge while required CI is red or absent");
  }

  if (satisfied === 6 && snapshot.candidateMerged === true) {
    satisfied = 7;
    blockedAt = 8;
  } else if (satisfied === 6) {
    agentActions.push("merge only after required CI is green");
  }

  if (satisfied === 7 && snapshot.proofRecorded === true) {
    satisfied = 8;
    blockedAt = 9;
  } else if (satisfied === 7) {
    ownerActions.push("record production or device proof; a simulator run is not proof");
  }

  if (satisfied === 8 && gates.length === 0 && missing.length === 0 && orphans === 0) {
    satisfied = 9;
    blockedAt = null;
  }

  return {
    id: snapshot.id,
    satisfiedPhase: satisfied,
    blockedAt,
    phaseName: phaseName(satisfied),
    ownerActions,
    agentActions,
    doNotMerge: keepRed > 0 || snapshot.requiredCiGreen === false,
    secretsInvented: false,
  };
}

export function classifyPortfolio(snapshots: ProbeSnapshot[]): PhaseVerdict[] {
  return snapshots
    .map(classifyPortfolioPhase)
    .sort((a, b) => a.satisfiedPhase - b.satisfiedPhase || a.id.localeCompare(b.id));
}
