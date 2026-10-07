/**
 * Project-agnostic stack collapse.
 * A portfolio that already has an open roadmap record does not get another witness.
 * Duplicate theme stacks are marked superseded. Keep-red and red-check records stay unmerged.
 * Does not fetch, merge, invent secrets, or treat a fixture as production proof.
 */

export type LanePosture = "ready" | "owner_blocked" | "alias_absent" | "unknown";

export type StackRecord = {
  repo: string;
  number: number;
  title: string;
  theme: string;
  draft?: boolean;
  keepRed?: boolean;
  requiredChecksRed?: boolean;
  openedAt: string;
};

export type StackInput = {
  coordination: LanePosture;
  product: LanePosture;
  alias: LanePosture;
  records: StackRecord[];
  keepRedNumbers?: number[];
};

export type StackAction = "refresh_in_place" | "owner_only" | "hold";

export type StackDecision = {
  action: StackAction;
  openNewPullRequest: false;
  mergeNumbers: [];
  refreshNumbers: number[];
  supersedeNumbers: number[];
  holdNumbers: number[];
  blockedByRedChecks: number[];
  reason: string;
};

const KEEP_RED_TITLE = /do not merge|keep red|draft keep red/i;

function isHold(record: StackRecord, keepRedNumbers: number[]): boolean {
  return Boolean(
    record.draft ||
      record.keepRed ||
      keepRedNumbers.includes(record.number) ||
      KEEP_RED_TITLE.test(record.title),
  );
}

function newestByTheme(records: StackRecord[]): Map<string, StackRecord> {
  const newest = new Map<string, StackRecord>();
  for (const record of records) {
    const key = `${record.repo}:${record.theme}`;
    const current = newest.get(key);
    if (!current || record.openedAt > current.openedAt) newest.set(key, record);
  }
  return newest;
}

export function collapseStacks(input: StackInput): StackDecision {
  const keepRedNumbers = input.keepRedNumbers ?? [];
  const holdNumbers = input.records.filter((record) => isHold(record, keepRedNumbers)).map((record) => record.number);
  const movable = input.records.filter((record) => !isHold(record, keepRedNumbers));
  const newest = newestByTheme(movable);
  const refreshNumbers = [...newest.values()].map((record) => record.number).sort((a, b) => a - b);
  const supersedeNumbers = movable
    .filter((record) => newest.get(`${record.repo}:${record.theme}`)?.number !== record.number)
    .map((record) => record.number)
    .sort((a, b) => a - b);
  const blockedByRedChecks = input.records.filter((record) => record.requiredChecksRed).map((record) => record.number).sort((a, b) => a - b);

  const productBlocked = input.product === "owner_blocked";
  const base = {
    openNewPullRequest: false as const,
    mergeNumbers: [] as [],
    refreshNumbers,
    supersedeNumbers,
    holdNumbers,
    blockedByRedChecks,
  };

  if (productBlocked) {
    return {
      ...base,
      action: refreshNumbers.length > 0 ? "refresh_in_place" : "owner_only",
      reason:
        "product host is owner-blocked; refresh the newest record per theme, supersede older duplicates, merge nothing, invent no secret",
    };
  }
  return {
    ...base,
    action: "hold",
    reason: "required checks that are red stay unmerged; keep-red fences stay unmerged",
  };
}
