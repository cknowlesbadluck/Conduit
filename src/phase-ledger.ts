/**
 * Executable 10-phase portfolio ledger.
 * Turns probe facts and open-pull facts into phase state and prune actions.
 * A ledger is not a deploy and does not invent secrets.
 */

export const KEEP_RED = [119, 120, 155, 162] as const;
export const OWNER_SECRET = "SUPABASE_SERVICE_ROLE_KEY";

export type PhaseState = "met" | "owner_blocked" | "open" | "refused";

export type Phase = {
  id: number;
  name: string;
  state: PhaseState;
  exit: string;
};

export type Snapshot = {
  conduitReady: boolean;
  resonanceStatus: number;
  resonanceMissing: string[];
  resonanceLeaksContract: boolean;
  vercelAliasAbsent: boolean;
  witnessBudgetSpent: boolean;
  hardwareRunRecorded: boolean;
  legacyArchiveStatus: number;
};

export type BranchFact = {
  name: string;
  hasOpenPull: boolean;
  shaEqualsDefault: boolean;
};

export type PullFact = {
  number: number;
  title: string;
  draft: boolean;
};

export type PruneAction =
  | { kind: "delete_branch"; name: string; reason: "merged_equivalent" | "orphan_fence" }
  | { kind: "close_pull"; number: number; reason: "bolt_noise" }
  | { kind: "refuse_merge"; number: number; reason: "keep_red" }
  | { kind: "owner_only"; action: "set_service_role" | "archive_legacy" | "device_hg" };

export function evaluatePhases(snapshot: Snapshot): Phase[] {
  const ownerBlocked =
    snapshot.resonanceStatus === 503 &&
    snapshot.resonanceMissing.length === 1 &&
    snapshot.resonanceMissing[0] === OWNER_SECRET &&
    !snapshot.resonanceLeaksContract;

  return [
    {
      id: 1,
      name: "Owner gate",
      state: ownerBlocked ? "owner_blocked" : snapshot.resonanceStatus === 200 ? "met" : "open",
      exit: "public /api/ready is 200 and still omits ownerActionRequired",
    },
    {
      id: 2,
      name: "Deploy-lag kill",
      state: snapshot.vercelAliasAbsent ? "open" : "met",
      exit: "canonical host ready body contains contractRevision after the owner key",
    },
    {
      id: 3,
      name: "Entropy governor",
      state: snapshot.witnessBudgetSpent ? "met" : "open",
      exit: "a new witness pull is refused when two witness pulls are open",
    },
    {
      id: 4,
      name: "Collapse unmerged planners",
      state: "open",
      exit: "one squash per repo or an explicit close; no red required CI merged",
    },
    {
      id: 5,
      name: "Device fence",
      state: snapshot.hardwareRunRecorded ? "met" : "owner_blocked",
      exit: "recorded hardware run on iPhone 16e",
    },
    {
      id: 6,
      name: "Chamber fail-closed",
      state: "open",
      exit: "execution stays denied when a capability is not executable",
    },
    {
      id: 7,
      name: "Hygiene prune",
      state: snapshot.legacyArchiveStatus === 403 ? "owner_blocked" : "open",
      exit: "orphan branches gone; legacy twin archived; keep-red untouched",
    },
    {
      id: 8,
      name: "Single iOS peer",
      state: "open",
      exit: "one iOS target consumes the Nexus capability model after phase 1",
    },
    {
      id: 9,
      name: "Grant and TLS deny-by-default",
      state: "refused",
      exit: "keep-red TLS pulls stay unmerged until Render env is set",
    },
    {
      id: 10,
      name: "Cross-plane acceptance",
      state: snapshot.conduitReady && snapshot.resonanceStatus === 200 && snapshot.hardwareRunRecorded ? "met" : "open",
      exit: "Conduit ready, Resonance ready 200, and a device archive on production",
    },
  ];
}

export function bindingPhase(phases: Phase[]): number {
  const blocked = phases.find((phase) => phase.state === "owner_blocked");
  return blocked?.id ?? 0;
}

export function planPrune(branches: BranchFact[], pulls: PullFact[]): PruneAction[] {
  const actions: PruneAction[] = [];
  for (const branch of branches) {
    if (branch.name === "main" || branch.name.startsWith("release/")) continue;
    if (branch.shaEqualsDefault) {
      actions.push({ kind: "delete_branch", name: branch.name, reason: "merged_equivalent" });
      continue;
    }
    if (!branch.hasOpenPull && branch.name.startsWith("hygiene/")) {
      actions.push({ kind: "delete_branch", name: branch.name, reason: "orphan_fence" });
    }
  }
  for (const pull of pulls) {
    if ((KEEP_RED as readonly number[]).includes(pull.number) || pull.draft && /KEEP RED/i.test(pull.title)) {
      actions.push({ kind: "refuse_merge", number: pull.number, reason: "keep_red" });
      continue;
    }
    if (/bolt/i.test(pull.title) || pull.title.includes("⚡")) {
      actions.push({ kind: "close_pull", number: pull.number, reason: "bolt_noise" });
    }
  }
  actions.push({ kind: "owner_only", action: "set_service_role" });
  actions.push({ kind: "owner_only", action: "archive_legacy" });
  actions.push({ kind: "owner_only", action: "device_hg" });
  return actions;
}
