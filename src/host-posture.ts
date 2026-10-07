/**
 * Project-agnostic host posture classifier.
 * Turns a probe status and body into a disposition. Does not fetch URLs,
 * store secrets, or treat a fixture as production proof.
 */

export type HostPosture =
  | "ready"
  | "owner_blocked"
  | "alias_absent"
  | "deploy_lag"
  | "degraded"
  | "unknown";

export type HostProbe = {
  httpStatus: number;
  /** Raw body. Strings and JSON objects are both accepted. Credentials must not be passed. */
  body?: unknown;
  /** True when repository source already emits the contract fields the host omitted. */
  sourceEmitsContract?: boolean;
};

export type HostPostureDecision = {
  posture: HostPosture;
  reason: string;
  missingRequired: string[];
  contractFieldsPresent: boolean;
};

function asRecord(body: unknown): Record<string, unknown> | undefined {
  if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  return undefined;
}

function missingRequired(body: Record<string, unknown> | undefined): string[] {
  const raw = body?.missingRequired;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length < 120);
}

function bodyText(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 2000);
  if (body == null) return "";
  try {
    return JSON.stringify(body).slice(0, 2000);
  } catch {
    return "";
  }
}

export function classifyHostProbe(probe: HostProbe): HostPostureDecision {
  const record = asRecord(probe.body);
  const missing = missingRequired(record);
  const text = bodyText(probe.body);
  const contractFieldsPresent = Boolean(record && ("ownerActionRequired" in record || "contractRevision" in record));
  const aliasAbsent = probe.httpStatus === 404 && /DEPLOYMENT_NOT_FOUND/.test(text);

  if (aliasAbsent) {
    return {
      posture: "alias_absent",
      reason: "host returned DEPLOYMENT_NOT_FOUND; this is an absent alias, not an owner secret gate",
      missingRequired: [],
      contractFieldsPresent: false,
    };
  }

  if (probe.httpStatus === 200 && record?.status === "ready") {
    return {
      posture: "ready",
      reason: "host returned 200 ready",
      missingRequired: missing,
      contractFieldsPresent,
    };
  }

  if (missing.length > 0 && (probe.httpStatus === 503 || probe.httpStatus === 424)) {
    const lag = Boolean(probe.sourceEmitsContract && !contractFieldsPresent);
    return {
      posture: lag ? "deploy_lag" : "owner_blocked",
      reason: lag
        ? "host is missing an owner secret and is also serving a body older than source"
        : "host is blocked on an owner secret; do not invent it",
      missingRequired: missing,
      contractFieldsPresent,
    };
  }

  if (probe.httpStatus >= 500 || record?.status === "not_ready" || record?.status === "degraded") {
    return {
      posture: "degraded",
      reason: "host is up enough to answer but is not ready",
      missingRequired: missing,
      contractFieldsPresent,
    };
  }

  return {
    posture: "unknown",
    reason: "probe did not match ready, owner-blocked, alias-absent, or degraded",
    missingRequired: missing,
    contractFieldsPresent,
  };
}

/** Drop any credential assignment before a decision is logged. Key names may remain. */
export function redactPosture(decision: HostPostureDecision): HostPostureDecision {
  const scrub = (value: string) =>
    value.replace(
      /(?:SERVICE_ROLE|SECRET|TOKEN|PASSWORD|DATABASE_URL)[A-Z0-9_]*\s*=\s*\S+/gi,
      (match) => match.replace(/=.*/, "=[redacted]"),
    );
  return {
    ...decision,
    reason: scrub(decision.reason),
    missingRequired: decision.missingRequired.map(scrub),
  };
}
