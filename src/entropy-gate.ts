/**
 * Project-agnostic work admission gate.
 * Classifies open change records and decides whether a new change may start.
 * Does not store secrets, call providers, or mutate repositories.
 */

export type WorkDisposition = "keep" | "rebase" | "close" | "secret_blocked" | "active";

export type OpenWork = {
  id: string;
  title: string;
  /** Base commit the change was opened against, when known. */
  baseSha?: string;
  /** Commits the change is behind the current default branch. */
  behind?: number;
  /** True when merge is blocked on an owner secret that must not be invented. */
  secretBlocked?: boolean;
};

export type ClassifiedWork = {
  id: string;
  disposition: WorkDisposition;
  reason: string;
  invariant: string;
};

export type AdmissionDecision = {
  admit: boolean;
  reason: string;
  invariant: string;
  collidingIds: string[];
  prune: ClassifiedWork[];
};

const KEEP_RED = /KEEP\s+RED|DO NOT MERGE/i;
const BOLT_NOISE = /^\s*(?:⚡\s*)?Bolt\b/i;
const STALE_BEHIND = 7;

export function invariantKey(title: string): string {
  const stripped = title
    .replace(/^\s*(?:⚡\s*)?(?:feat|fix|chore|harden|docs|refactor|test|bolt)\s*:\s*/i, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2 && !["the", "and", "for", "with"].includes(word))
    .slice(0, 6);
  return stripped.join("-") || "untitled";
}

export function classifyOpenWork(item: OpenWork, currentBaseSha?: string): ClassifiedWork {
  const invariant = invariantKey(item.title);
  if (KEEP_RED.test(item.title)) {
    return { id: item.id, disposition: "keep", invariant, reason: "explicit keep-red or do-not-merge marker" };
  }
  if (item.secretBlocked) {
    return { id: item.id, disposition: "secret_blocked", invariant, reason: "blocked on an owner secret; do not invent it and do not merge" };
  }
  if (BOLT_NOISE.test(item.title)) {
    return { id: item.id, disposition: "close", invariant, reason: "micro-optimization during stabilization; not a product slice" };
  }
  const behind = item.behind ?? 0;
  const baseMoved = Boolean(currentBaseSha && item.baseSha && item.baseSha !== currentBaseSha);
  if (baseMoved && behind >= STALE_BEHIND) {
    return { id: item.id, disposition: "close", invariant, reason: `stale against current base (${behind} behind)` };
  }
  if (baseMoved && behind > 0) {
    return { id: item.id, disposition: "rebase", invariant, reason: `base moved; rebase before merge (${behind} behind)` };
  }
  return { id: item.id, disposition: "active", invariant, reason: "in-scope open work" };
}

/**
 * Admit a new change only when it does not collide with active or secret-blocked
 * work on the same invariant, and when the portfolio is not already over the
 * open-work ceiling. Keep-red records never count as a collision to close,
 * but they do block a duplicate invariant.
 */
export function admitChange(
  proposal: { title: string },
  open: readonly OpenWork[],
  options?: { currentBaseSha?: string; openCeiling?: number },
): AdmissionDecision {
  const invariant = invariantKey(proposal.title);
  const prune = open.map((item) => classifyOpenWork(item, options?.currentBaseSha));
  const ceiling = options?.openCeiling ?? 8;
  const colliding = prune.filter((item) => item.invariant === invariant && item.disposition !== "close");
  if (colliding.length > 0) {
    return {
      admit: false,
      reason: "invariant already has non-closed work; finish or explicitly supersede it",
      invariant,
      collidingIds: colliding.map((item) => item.id),
      prune,
    };
  }
  const stillOpen = prune.filter((item) => item.disposition !== "close").length;
  if (stillOpen >= ceiling) {
    return {
      admit: false,
      reason: `open-work ceiling ${ceiling} reached after prune classification; close or merge before starting new scope`,
      invariant,
      collidingIds: [],
      prune,
    };
  }
  return { admit: true, reason: "no invariant collision and under the open-work ceiling", invariant, collidingIds: [], prune };
}
