/**
 * Project-agnostic saturation governor.
 * One decision for a portfolio that is already over its open-work budget.
 * Does not fetch, merge, invent secrets, or treat a fixture as production proof.
 */

import { classifyHostProbe, type HostProbe } from "./host-posture.js";

export type OpenRecord = {
  number: number;
  title: string;
  draft?: boolean;
  /** True when the record adds a generated declaration dump. That is noise even without a Bolt title. */
  generatedDeclarationDump?: boolean;
};

export type AllowedMutation = "refresh_in_place" | "close_noise" | "owner_only" | "hold";

export type GovernorInput = {
  coordination?: HostProbe;
  product?: HostProbe;
  alias?: HostProbe;
  openRecords: OpenRecord[];
  keepRedNumbers?: number[];
  roadmapAlreadyOpen?: boolean;
  probedAt?: string;
};

export type PhaseState = "done" | "blocked" | "open" | "hold";

export type Phase = {
  id: number;
  name: string;
  exit: string;
  state: PhaseState;
};

export type GovernorDecision = {
  mutation: AllowedMutation;
  openNewPullRequest: false;
  closeNumbers: number[];
  holdNumbers: number[];
  reason: string;
  phases: Phase[];
};

const KEEP_RED = /do not merge|keep red|draft keep red/i;
const NOISE = /^\s*(?:⚡\s*)?Bolt\b/i;

function isHold(record: OpenRecord, keepRedNumbers: number[]): boolean {
  return Boolean(record.draft || keepRedNumbers.includes(record.number) || KEEP_RED.test(record.title));
}

function isNoise(record: OpenRecord): boolean {
  return NOISE.test(record.title) || Boolean(record.generatedDeclarationDump);
}

export function governSaturation(input: GovernorInput): GovernorDecision {
  const keepRedNumbers = input.keepRedNumbers ?? [];
  const coordination = input.coordination ? classifyHostProbe(input.coordination) : undefined;
  const product = input.product ? classifyHostProbe(input.product) : undefined;
  const alias = input.alias ? classifyHostProbe(input.alias) : undefined;
  const holdNumbers = input.openRecords.filter((record) => isHold(record, keepRedNumbers)).map((record) => record.number);
  const closeNumbers = input.openRecords
    .filter((record) => isNoise(record) && !isHold(record, keepRedNumbers))
    .map((record) => record.number);

  const productBlocked = product?.posture === "owner_blocked" || product?.posture === "deploy_lag";
  const coordinationReady = coordination?.posture === "ready";
  const aliasAbsent = alias?.posture === "alias_absent";
  const roadmapOpen = Boolean(input.roadmapAlreadyOpen);

  const phases: Phase[] = [
    { id: 1, name: "Owner gate", exit: "product ready is 200; secret is never invented", state: productBlocked ? "blocked" : product?.posture === "ready" ? "done" : "open" },
    { id: 2, name: "Single ready-body pin", exit: "one ready-body change, merged only on green required checks", state: productBlocked ? "hold" : "open" },
    { id: 3, name: "Coordination host stamp", exit: "health and ready share one contractRevision and name postgres", state: coordinationReady ? "done" : "open" },
    { id: 4, name: "Saturation governor", exit: "no new pull request while a roadmap record is open and the product host is owner-blocked", state: roadmapOpen && productBlocked ? "done" : "open" },
    { id: 5, name: "Alias classification", exit: "404 DEPLOYMENT_NOT_FOUND is alias_absent, not an owner gate", state: aliasAbsent ? "done" : alias ? "open" : "hold" },
    { id: 6, name: "Keep-red fence", exit: "draft and do-not-merge records stay unmerged", state: holdNumbers.length > 0 ? "hold" : "open" },
    { id: 7, name: "Hygiene prune", exit: "bolt noise closed; orphan branches gone; activity prune ran", state: closeNumbers.length > 0 ? "open" : "hold" },
    { id: 8, name: "Device gate stays outside coordination", exit: "simulator CI is not device acceptance", state: "hold" },
    { id: 9, name: "Deny-by-default grants", exit: "resource records hold no secrets; bridge calls stay denied without a grant", state: "open" },
    { id: 10, name: "Cross-plane acceptance", exit: "coordination ready, product ready, and a device gate that is not a unit test", state: coordinationReady && product?.posture === "ready" ? "open" : "blocked" },
  ];

  const base = { openNewPullRequest: false as const, closeNumbers, holdNumbers, phases };

  if (productBlocked && roadmapOpen) {
    return {
      ...base,
      mutation: closeNumbers.length > 0 ? "close_noise" : "refresh_in_place",
      reason: closeNumbers.length > 0
        ? "product host is owner-blocked; close bolt noise and refresh the open roadmap, do not open another record"
        : "product host is owner-blocked and a roadmap record is already open; refresh it",
    };
  }
  if (productBlocked) {
    return { ...base, mutation: "owner_only", reason: "product host is blocked on an owner secret; do not invent it" };
  }
  if (holdNumbers.length > 0 && closeNumbers.length === 0) {
    return { ...base, mutation: "hold", reason: "keep-red records stay unmerged; no other mutation is admitted" };
  }
  return { ...base, mutation: "refresh_in_place", reason: "saturation default is refresh in place, never a new witness" };
}
