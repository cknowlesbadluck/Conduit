/**
 * Project-agnostic orphan surface.
 * A branch with a unique commit and no open pull request is unfinished work,
 * not a reason to open a second witness. Protected and release refs are never
 * prune candidates. This module does not delete refs or invent secrets.
 */

export type BranchRef = {
  name: string;
  protected?: boolean;
  /** True when an open pull request already tracks this branch. */
  hasOpenPullRequest?: boolean;
  /** True when HEAD is not an ancestor-only copy of the default branch. */
  uniqueCommit?: boolean;
};

export type OrphanDisposition = "hold" | "tracked" | "open_pr" | "prune_candidate";

export type OrphanDecision = {
  name: string;
  disposition: OrphanDisposition;
  reason: string;
};

const RELEASE = /^(main|master|release\/)/;
const NOISE = /^(bolt\/|dependabot\/)/;

export function classifyBranch(branch: BranchRef): OrphanDecision {
  if (branch.protected || RELEASE.test(branch.name)) {
    return { name: branch.name, disposition: "hold", reason: "protected or release ref; never prune" };
  }
  if (branch.hasOpenPullRequest) {
    return { name: branch.name, disposition: "tracked", reason: "already represented by an open pull request" };
  }
  if (NOISE.test(branch.name)) {
    return { name: branch.name, disposition: "prune_candidate", reason: "untracked noise branch; not a product slice" };
  }
  if (branch.uniqueCommit) {
    return {
      name: branch.name,
      disposition: "open_pr",
      reason: "unique commit with no pull request; open the existing branch, do not fork a witness",
    };
  }
  return { name: branch.name, disposition: "prune_candidate", reason: "no unique commit and no pull request" };
}

export function planOrphanSurface(branches: readonly BranchRef[]): {
  openExisting: string[];
  pruneCandidates: string[];
  hold: string[];
  decisions: OrphanDecision[];
} {
  const decisions = branches.map(classifyBranch);
  return {
    openExisting: decisions.filter((item) => item.disposition === "open_pr").map((item) => item.name),
    pruneCandidates: decisions.filter((item) => item.disposition === "prune_candidate").map((item) => item.name),
    hold: decisions.filter((item) => item.disposition === "hold" || item.disposition === "tracked").map((item) => item.name),
    decisions,
  };
}
