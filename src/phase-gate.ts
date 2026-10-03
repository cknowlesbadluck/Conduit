/**
 * Generic phase gate. Callers supply phase specs and probe facts.
 * This module does not name any product, host, or secret.
 *
 * A later phase may already satisfy its own exit while an earlier
 * owner-only phase is still open. That is recorded as satisfiedAhead.
 * It is never treated as the next action.
 */

export type ProbeFact = {
  service: string;
  httpStatus: number;
  missingRequired?: readonly string[];
  contractRevision?: string | null;
  ownerActionRequired?: boolean | null;
  version?: string | null;
  persistence?: string | null;
};

export type PhaseSpec = {
  id: string;
  title: string;
  ownerOnly: boolean;
  dependsOn?: readonly string[];
  met: (probes: readonly ProbeFact[]) => boolean;
};

export type PhasePlan = {
  met: string[];
  open: string[];
  satisfiedAhead: string[];
  next: string | null;
  nextOwnerOnly: boolean;
  bindingConstraint: string | null;
};

export function probeByService(probes: readonly ProbeFact[], service: string): ProbeFact | undefined {
  return probes.find((probe) => probe.service === service);
}

export function hasMissingRequired(probe: ProbeFact | undefined): boolean {
  return (probe?.missingRequired?.length ?? 0) > 0;
}

export function planPhases(phases: readonly PhaseSpec[], probes: readonly ProbeFact[]): PhasePlan {
  const met = new Set<string>();
  for (const phase of phases) {
    if (phase.met(probes)) met.add(phase.id);
  }

  const open: string[] = [];
  const satisfiedAhead: string[] = [];
  let ownerBlocked = false;
  let next: string | null = null;
  let nextOwnerOnly = false;
  let bindingConstraint: string | null = null;

  for (const phase of phases) {
    const depsOpen = (phase.dependsOn ?? []).some((id) => !met.has(id));
    const selfMet = met.has(phase.id);
    const blockedByEarlierOwner = ownerBlocked && !phase.ownerOnly;
    if (selfMet && !depsOpen && !blockedByEarlierOwner) continue;
    if (selfMet && (depsOpen || blockedByEarlierOwner)) {
      satisfiedAhead.push(phase.id);
      continue;
    }
    open.push(phase.id);
    if (next === null) {
      next = phase.id;
      nextOwnerOnly = phase.ownerOnly;
      bindingConstraint = phase.ownerOnly
        ? `${phase.id} is owner-only`
        : `${phase.id} is the next agent phase`;
    }
    if (phase.ownerOnly) ownerBlocked = true;
  }

  return {
    met: phases.filter((phase) => met.has(phase.id) && !satisfiedAhead.includes(phase.id)).map((phase) => phase.id),
    open,
    satisfiedAhead,
    next,
    nextOwnerOnly,
    bindingConstraint,
  };
}
