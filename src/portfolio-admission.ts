/**
 * Portfolio admission. Facts in, one next action out.
 * A narrative audit is not a gate. An alias host is not proof.
 * Owner blocks outrank green exits. Entropy over budget is not new scope.
 */

export const PROOF_HOST = "resonancenexus.netlify.app";
export const ADMISSION_BUDGET = 4;
export const HELD_PULLS = [119, 120, 155] as const;
export const EXPECTED_CONDUIT_REVISION = "2026-10-03-ready-surface";

export type SurfaceSplit =
  | "aligned"
  | "ready_missing_stamp"
  | "health_missing_stamp"
  | "revision_mismatch"
  | "version_mismatch";

export type AdmissionAction = "owner" | "prune" | "hold" | "implement";

export type PortfolioProbe = {
  conduitHealthStatus: number;
  conduitReadyStatus: number;
  conduitVersion?: string;
  conduitContractRevision?: string;
  conduitPersistence?: string;
  surfaceSplit: SurfaceSplit;
  resonanceReadyStatus: number;
  resonanceMissing: string[];
  resonanceHasOwnerActionRequired: boolean;
  resonanceHasContractRevision: boolean;
  resonanceHost: string;
  openNonHeldPulls: number;
  deviceHgProven: boolean;
};

export type Admission = {
  action: AdmissionAction;
  phase: number;
  admissible: boolean;
  reason: string;
  ownerBlocks: string[];
};

export function classifyProofHost(host: string): "proof" | "alias" | "unknown" {
  const normalized = host.trim().toLowerCase().replace(/\/$/, "");
  if (normalized === PROOF_HOST) return "proof";
  if (normalized.endsWith(".vercel.app") || normalized.includes("vercel.app")) return "alias";
  return "unknown";
}

function missingIsExactServiceRole(missing: string[]): boolean {
  return missing.length === 1 && missing[0] === "SUPABASE_SERVICE_ROLE_KEY";
}

/**
 * Rank the single next action. Owner blocks win. Then entropy. Then held drafts.
 * Implementation is admissible only when the probe is aligned, the proof host is
 * the public Netlify host, and the open non-held pull count is inside budget.
 */
export function admitPortfolio(probe: PortfolioProbe): Admission {
  const ownerBlocks: string[] = [];
  if (classifyProofHost(probe.resonanceHost) === "alias") ownerBlocks.push("alias_host_is_not_proof");
  if (probe.resonanceReadyStatus !== 200) {
    if (missingIsExactServiceRole(probe.resonanceMissing) && !probe.resonanceHasOwnerActionRequired) {
      ownerBlocks.push("resonance_service_role_missing");
    } else {
      ownerBlocks.push("resonance_ready_not_200");
    }
  }
  if (!probe.deviceHgProven) ownerBlocks.push("quicksilver_device_hg_unproven");

  if (probe.surfaceSplit !== "aligned" || probe.conduitHealthStatus !== 200 || probe.conduitReadyStatus !== 200) {
    return {
      action: "implement",
      phase: 1,
      admissible: probe.openNonHeldPulls <= ADMISSION_BUDGET,
      reason: "Conduit health and ready are not one stamped contract. Fix the surface before new scope.",
      ownerBlocks,
    };
  }

  if (probe.conduitContractRevision !== EXPECTED_CONDUIT_REVISION || probe.conduitPersistence !== "postgres") {
    return {
      action: "hold",
      phase: 1,
      admissible: false,
      reason: "Live Conduit is 200 but not the committed 0.8.0 postgres ready-surface contract.",
      ownerBlocks,
    };
  }

  if (ownerBlocks.includes("resonance_service_role_missing") || ownerBlocks.includes("alias_host_is_not_proof")) {
    return {
      action: "owner",
      phase: 2,
      admissible: false,
      reason: "Resonance public ready is owner-blocked. Do not invent the service role key. An alias deploy is not the gate.",
      ownerBlocks,
    };
  }

  if (probe.openNonHeldPulls > ADMISSION_BUDGET) {
    return {
      action: "prune",
      phase: 3,
      admissible: false,
      reason: `Open non-held pulls ${probe.openNonHeldPulls} exceed budget ${ADMISSION_BUDGET}. Close, rebase, or land. Do not open another roadmap.`,
      ownerBlocks,
    };
  }

  if (!probe.deviceHgProven) {
    return {
      action: "owner",
      phase: 4,
      admissible: false,
      reason: "Simulator CI is not device acceptance. iPhone 16e archive IPA remains the Quicksilver gate.",
      ownerBlocks,
    };
  }

  return {
    action: "implement",
    phase: 5,
    admissible: true,
    reason: "Owner gates clear and entropy is inside budget. Next work is a thin vertical slice, not another audit file.",
    ownerBlocks,
  };
}
