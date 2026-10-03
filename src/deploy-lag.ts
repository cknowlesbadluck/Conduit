export type LiveProofClass = "live-proof" | "deploy-lag" | "owner-blocked" | "unproven";

export interface LiveProbe {
  httpStatus: number;
  body: Record<string, unknown>;
}

export interface ExpectedContract {
  version?: string;
  contractRevision?: string;
}

export interface LiveProofVerdict {
  class: LiveProofClass;
  reason: string;
}

function missingRequired(body: Record<string, unknown>): string[] {
  const value = body.missingRequired;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function classifyLiveProof(probe: LiveProbe, expected: ExpectedContract = {}): LiveProofVerdict {
  const missing = missingRequired(probe.body);
  if (missing.includes("SUPABASE_SERVICE_ROLE_KEY")) {
    return {
      class: "owner-blocked",
      reason: "missing SUPABASE_SERVICE_ROLE_KEY; do not invent the secret",
    };
  }
  if (probe.httpStatus !== 200) {
    return { class: "unproven", reason: `http ${probe.httpStatus} is not live proof` };
  }
  if (expected.contractRevision && probe.body.contractRevision !== expected.contractRevision) {
    return {
      class: "deploy-lag",
      reason: "contractRevision absent or mismatched; 200 is not this commit",
    };
  }
  if (expected.version && probe.body.version !== expected.version) {
    return {
      class: "deploy-lag",
      reason: "version absent or mismatched; 200 is not this commit",
    };
  }
  return { class: "live-proof", reason: "status and expected contract match" };
}
