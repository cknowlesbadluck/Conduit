/**
 * Project-agnostic classification of a public probe.
 * Callers pass the HTTP status and body. This module does not fetch,
 * does not name a product, and never treats a fixture as production proof.
 */

export type ProbeVerdict =
  | "ready"
  | "owner_gate"
  | "deploy_lag"
  | "alias_absent"
  | "device_not_recorded"
  | "not_ready"
  | "unreadable";

export type ProbeInput = {
  httpStatus: number;
  body: string;
};

export type ProbeClassification = {
  verdict: ProbeVerdict;
  productionProof: false;
  missingRequired: string[];
  deployLag: boolean;
  aliasAbsent: boolean;
};

function readJson(body: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(body) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function classifyProbe(input: ProbeInput): ProbeClassification {
  const text = input.body ?? "";
  if (input.httpStatus === 404 || text.includes("DEPLOYMENT_NOT_FOUND")) {
    return { verdict: "alias_absent", productionProof: false, missingRequired: [], deployLag: false, aliasAbsent: true };
  }
  const json = readJson(text);
  if (!json) {
    return { verdict: "unreadable", productionProof: false, missingRequired: [], deployLag: false, aliasAbsent: false };
  }
  if (json.deviceAcceptance === "not_recorded") {
    return { verdict: "device_not_recorded", productionProof: false, missingRequired: [], deployLag: false, aliasAbsent: false };
  }
  const missing = Array.isArray(json.missingRequired)
    ? json.missingRequired.filter((item): item is string => typeof item === "string")
    : [];
  const status = typeof json.status === "string" ? json.status : "";
  const deployLag = status.length > 0 && !("contractRevision" in json) && input.httpStatus >= 500;
  if (status === "ready" && input.httpStatus === 200 && missing.length === 0) {
    return { verdict: "ready", productionProof: false, missingRequired: [], deployLag: false, aliasAbsent: false };
  }
  if (missing.length > 0) {
    return { verdict: "owner_gate", productionProof: false, missingRequired: missing, deployLag, aliasAbsent: false };
  }
  if (deployLag) {
    return { verdict: "deploy_lag", productionProof: false, missingRequired: missing, deployLag: true, aliasAbsent: false };
  }
  return { verdict: "not_ready", productionProof: false, missingRequired: missing, deployLag: false, aliasAbsent: false };
}
