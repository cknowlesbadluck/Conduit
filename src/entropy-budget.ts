/**
 * Portfolio entropy budget.
 *
 * Classifies whether another change is allowed from probe facts and the open
 * pull-request inventory. Narrative status docs are not an input.
 * Owner gates outrank green exits. A do-not-merge pull request is never landable.
 */

export const ENTROPY_BUDGET_REVISION = "2026-10-03-entropy-budget";

export type RepoName = "Conduit" | "Resonance" | "QuicksilverV1" | "Quicksilver" | "mcp";

export type ProbeFacts = {
  conduitHealthStatus: number;
  conduitReadyStatus: number;
  conduitVersion?: string;
  conduitPersistence?: string;
  conduitContractRevision?: string;
  resonanceReadyStatus: number;
  resonanceMissing?: string[];
  resonanceHasOwnerAction: boolean;
};

export type OpenPull = {
  repo: RepoName;
  number: number;
  draft: boolean;
  doNotMerge: boolean;
  kind: "feature" | "docs" | "harden" | "dependabot";
};

export type PhaseId =
  | "P0_entropy_budget"
  | "P1_owner_gates"
  | "P2_resonance_deploy_parity"
  | "P3_land_or_close"
  | "P4_device_acceptance"
  | "P5_ai_error_slice"
  | "P6_capability_model"
  | "P7_ordered_migrations"
  | "P8_chamber_slice"
  | "P9_cross_surface_loop"
  | "P10_release_hardening";

export type BudgetDecision = {
  revision: typeof ENTROPY_BUDGET_REVISION;
  allowNetNewFeature: boolean;
  allowDocsRefresh: boolean;
  nextAction: "prune" | "owner_gate" | "land_green_slice" | "advance";
  blockedPhase: PhaseId;
  reasons: string[];
};

const FEATURE_CAP = 4;

function missingServiceRole(probe: ProbeFacts): boolean {
  return probe.resonanceReadyStatus !== 200
    && (probe.resonanceMissing ?? []).includes("SUPABASE_SERVICE_ROLE_KEY");
}

function conduitAligned(probe: ProbeFacts): boolean {
  return probe.conduitHealthStatus === 200
    && probe.conduitReadyStatus === 200
    && probe.conduitVersion === "0.8.0"
    && probe.conduitPersistence === "postgres"
    && probe.conduitContractRevision === "2026-10-03-ready-surface";
}

/** First phase that is not allowed to pretend it is done. */
export function blockedPhase(probe: ProbeFacts, pulls: OpenPull[]): PhaseId {
  const featureCount = pulls.filter((pull) => pull.kind === "feature" || pull.kind === "harden").length;
  if (featureCount > FEATURE_CAP || pulls.some((pull) => pull.repo === "Quicksilver")) return "P0_entropy_budget";
  if (missingServiceRole(probe) || !probe.resonanceHasOwnerAction) return "P1_owner_gates";
  if (probe.resonanceReadyStatus !== 200) return "P2_resonance_deploy_parity";
  if (pulls.some((pull) => pull.doNotMerge || pull.draft)) return "P3_land_or_close";
  if (!conduitAligned(probe)) return "P3_land_or_close";
  return "P4_device_acceptance";
}

export function classifyEntropyBudget(probe: ProbeFacts, pulls: OpenPull[]): BudgetDecision {
  const reasons: string[] = [];
  const phase = blockedPhase(probe, pulls);
  const docsAlreadyOpen = pulls.some((pull) => pull.kind === "docs");
  const zombieLegacy = pulls.some((pull) => pull.repo === "Quicksilver");
  const featureCount = pulls.filter((pull) => pull.kind === "feature" || pull.kind === "harden").length;

  if (!conduitAligned(probe)) reasons.push("conduit_surface_not_aligned");
  if (missingServiceRole(probe)) reasons.push("owner_missing_SUPABASE_SERVICE_ROLE_KEY");
  if (!probe.resonanceHasOwnerAction) reasons.push("resonance_ready_omits_ownerActionRequired");
  if (zombieLegacy) reasons.push("legacy_quicksilver_pulls_still_open");
  if (featureCount > FEATURE_CAP) reasons.push(`open_feature_or_harden_count_${featureCount}_over_${FEATURE_CAP}`);
  if (docsAlreadyOpen) reasons.push("docs_refresh_already_open");
  if (pulls.some((pull) => pull.doNotMerge)) reasons.push("do_not_merge_pulls_present");

  const allowNetNewFeature = phase === "P4_device_acceptance" && !docsAlreadyOpen && featureCount <= FEATURE_CAP;
  const allowDocsRefresh = !docsAlreadyOpen && !zombieLegacy;
  const nextAction = zombieLegacy || featureCount > FEATURE_CAP
    ? "prune"
    : missingServiceRole(probe) || !probe.resonanceHasOwnerAction
      ? "owner_gate"
      : pulls.some((pull) => !pull.doNotMerge && !pull.draft)
        ? "land_green_slice"
        : "advance";

  return {
    revision: ENTROPY_BUDGET_REVISION,
    allowNetNewFeature,
    allowDocsRefresh,
    nextAction,
    blockedPhase: phase,
    reasons,
  };
}
