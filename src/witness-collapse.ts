/**
 * Project-agnostic witness collapse.
 * Given host postures and an open-PR inventory, decide the single allowed write.
 * Does not fetch, merge, store secrets, or treat a fixture as production proof.
 */

import { classifyHostProbe, type HostProbe } from "./host-posture.js";

export type OpenRecord = {
  number: number;
  title: string;
  draft?: boolean;
  keepRed?: boolean;
};

export type CollapseAction =
  | "refresh_in_place"
  | "owner_blocked"
  | "keep_red"
  | "alias_absent"
  | "admit_new"
  | "hold";

export type CollapseInput = {
  coordination?: HostProbe;
  product?: HostProbe;
  alias?: HostProbe;
  openRecords: OpenRecord[];
  /** Numbers that must not be merged even if CI later goes green. */
  keepRedNumbers?: number[];
  /** True when a roadmap file already exists on an open branch. */
  roadmapAlreadyOpen?: boolean;
};

export type Phase = {
  id: number;
  name: string;
  exit: string;
  state: "done" | "blocked" | "open" | "hold";
};

export type CollapseDecision = {
  action: CollapseAction;
  reason: string;
  openNewPullRequest: boolean;
  mergeCandidates: number[];
  holdNumbers: number[];
  phases: Phase[];
};

const KEEP_RED_TITLE = /do not merge|keep red|draft keep red/i;

function isKeepRed(record: OpenRecord, keepRedNumbers: number[]): boolean {
  return Boolean(record.keepRed || record.draft || keepRedNumbers.includes(record.number) || KEEP_RED_TITLE.test(record.title));
}

export function collapseWitnesses(input: CollapseInput): CollapseDecision {
  const keepRedNumbers = input.keepRedNumbers ?? [];
  const coordination = input.coordination ? classifyHostProbe(input.coordination) : undefined;
  const product = input.product ? classifyHostProbe(input.product) : undefined;
  const alias = input.alias ? classifyHostProbe(input.alias) : undefined;

  const holdNumbers = input.openRecords.filter((record) => isKeepRed(record, keepRedNumbers)).map((record) => record.number);
  const mergeCandidates = input.openRecords
    .filter((record) => !isKeepRed(record, keepRedNumbers))
    .map((record) => record.number);

  const coordinationReady = coordination?.posture === "ready";
  const productBlocked = product?.posture === "owner_blocked" || product?.posture === "deploy_lag";
  const aliasAbsent = alias?.posture === "alias_absent";
  const roadmapOpen = Boolean(input.roadmapAlreadyOpen);

  const phases: Phase[] = [
    {
      id: 1,
      name: "Owner gate",
      exit: "product ready is 200 and ownerActionRequired is false; secret is never invented",
      state: productBlocked ? "blocked" : product?.posture === "ready" ? "done" : "open",
    },
    {
      id: 2,
      name: "Single ready-body pin",
      exit: "one ready-body change, merged only when required checks are green",
      state: productBlocked ? "hold" : "open",
    },
    {
      id: 3,
      name: "Coordination host stamp",
      exit: "coordination health and ready share one contractRevision and name postgres",
      state: coordinationReady ? "done" : "open",
    },
    {
      id: 4,
      name: "Witness collapse",
      exit: "no new pull request while a roadmap record is already open and the product host is owner-blocked",
      state: roadmapOpen && productBlocked ? "done" : "open",
    },
    {
      id: 5,
      name: "Alias classification",
      exit: "404 DEPLOYMENT_NOT_FOUND is alias_absent, not an owner gate",
      state: aliasAbsent ? "done" : alias ? "open" : "hold",
    },
    {
      id: 6,
      name: "Keep-red fence",
      exit: "draft and do-not-merge records stay unmerged",
      state: holdNumbers.length > 0 ? "hold" : "open",
    },
    {
      id: 7,
      name: "Hygiene prune",
      exit: "orphan branches deleted; activity retention prune returns a count; no hourly audit file",
      state: "open",
    },
    {
      id: 8,
      name: "Device gate stays outside coordination",
      exit: "simulator CI is not device acceptance",
      state: "hold",
    },
    {
      id: 9,
      name: "Deny-by-default grants",
      exit: "resource records hold no secrets; bridge calls stay denied without a grant",
      state: "open",
    },
    {
      id: 10,
      name: "Cross-plane acceptance",
      exit: "coordination ready, product ready, and a device gate that is not a unit test",
      state: coordinationReady && product?.posture === "ready" ? "open" : "blocked",
    },
  ];

  if (productBlocked && roadmapOpen) {
    return {
      action: "refresh_in_place",
      reason: "product host is owner-blocked and a roadmap record is already open; refresh that record, do not open another",
      openNewPullRequest: false,
      mergeCandidates,
      holdNumbers,
      phases,
    };
  }

  if (productBlocked) {
    return {
      action: "owner_blocked",
      reason: "product host is blocked on an owner secret; do not invent it and do not open a product change",
      openNewPullRequest: false,
      mergeCandidates,
      holdNumbers,
      phases,
    };
  }

  if (aliasAbsent && !productBlocked) {
    return {
      action: "alias_absent",
      reason: "alias host is absent; that is not permission to open a deploy",
      openNewPullRequest: false,
      mergeCandidates,
      holdNumbers,
      phases,
    };
  }

  if (holdNumbers.length > 0 && mergeCandidates.length === 0) {
    return {
      action: "keep_red",
      reason: "every open record is keep-red or draft",
      openNewPullRequest: false,
      mergeCandidates,
      holdNumbers,
      phases,
    };
  }

  return {
    action: roadmapOpen ? "hold" : "admit_new",
    reason: roadmapOpen ? "roadmap record already open; hold" : "no owner block and no open roadmap record",
    openNewPullRequest: !roadmapOpen,
    mergeCandidates,
    holdNumbers,
    phases,
  };
}
