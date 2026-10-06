/**
 * Project-agnostic phase clock.
 *
 * Callers pass probe facts and phase slots. This module does not name a product,
 * store a secret, or decide that a unit test is production proof.
 */

export type ProbeClass =
  | "ready"
  | "owner_gate"
  | "alias_absent"
  | "contract_drift"
  | "unreachable"
  | "degraded";

export type HostProbe = {
  httpStatus: number;
  missingRequired?: readonly string[];
  hasContractRevision?: boolean;
  ownerActionRequired?: boolean | null;
  aliasError?: string | null;
  persistenceConfigured?: boolean | null;
};

const SECRET_KEY = /(_KEY|_SECRET|_TOKEN|PASSWORD|DATABASE_URL)/i;

export function classifyHostProbe(probe: HostProbe): ProbeClass {
  if (probe.aliasError === "DEPLOYMENT_NOT_FOUND" || probe.httpStatus === 404) return "alias_absent";
  if (probe.httpStatus === 0) return "unreachable";
  if (probe.httpStatus >= 500 && (probe.missingRequired?.length ?? 0) > 0) return "owner_gate";
  if (probe.httpStatus >= 500) return "degraded";
  if (probe.httpStatus >= 200 && probe.httpStatus < 300) {
    if (probe.hasContractRevision === false) return "contract_drift";
    if (probe.ownerActionRequired === true) return "owner_gate";
    if (probe.persistenceConfigured === false) return "owner_gate";
    return "ready";
  }
  return "degraded";
}

export type PhaseSlot = {
  id: number;
  name: string;
  exitCriterion: string;
  satisfied: boolean;
};

export type ClockReading = {
  phase: number;
  name: string;
  blocker: string;
  advance: boolean;
};

export function firstOpenPhase(slots: readonly PhaseSlot[]): ClockReading {
  const ordered = [...slots].sort((a, b) => a.id - b.id);
  const open = ordered.find((slot) => !slot.satisfied);
  if (!open) {
    return { phase: ordered.at(-1)?.id ?? 0, name: "closed", blocker: "none", advance: false };
  }
  return { phase: open.id, name: open.name, blocker: open.exitCriterion, advance: true };
}

export type MergeDecision = {
  allow: boolean;
  reason: string;
};

/** A keep-red pull request or a red required check is not a merge. */
export function decideMerge(input: { keepRed: boolean; requiredCiGreen: boolean }): MergeDecision {
  if (input.keepRed) return { allow: false, reason: "keep_red" };
  if (!input.requiredCiGreen) return { allow: false, reason: "required_ci_red" };
  return { allow: true, reason: "clear" };
}

/** Names of missing config may be reported. Values must never be. */
export function redactProbe(probe: HostProbe): HostProbe {
  return {
    httpStatus: probe.httpStatus,
    missingRequired: probe.missingRequired?.filter((name) => SECRET_KEY.test(name) || name.length > 0).map((name) => name),
    hasContractRevision: probe.hasContractRevision,
    ownerActionRequired: probe.ownerActionRequired,
    aliasError: probe.aliasError,
    persistenceConfigured: probe.persistenceConfigured,
  };
}

export function assertNoSecretValues(serialized: string): boolean {
  return !/eyJ[A-Za-z0-9_-]{10,}/.test(serialized) && !/postgres:\/\//.test(serialized);
}
