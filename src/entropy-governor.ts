/**
 * Portfolio entropy governor.
 * Classifies live probes and refuses another witness PR when the open
 * non-keep-red budget is already spent. This is not a deploy and not a secret.
 */

export const HEALTH_CONTRACT_REVISION = "2026-10-03-ready-surface";
export const OWNER_SECRET = "SUPABASE_SERVICE_ROLE_KEY";
export const KEEP_RED_PULLS = [119, 120, 155, 162] as const;
export const WITNESS_BUDGET = 2;

export type ProbeName = "conduit_health" | "conduit_ready" | "resonance_ready" | "vercel_alias";

export type ProbeClass =
  | "conduit_ready"
  | "resonance_owner_gate"
  | "alias_absent"
  | "contract_leak"
  | "unexpected";

export type AdmissionKind = "witness" | "implementation" | "owner";

export type Admission = {
  admit: boolean;
  reason:
    | "owner_action_is_not_an_agent_pr"
    | "witness_budget_spent"
    | "implementation_allowed"
    | "keep_red_refused";
};

export function classifyProbe(name: ProbeName, status: number, body: Record<string, unknown>): ProbeClass {
  if (name === "vercel_alias") {
    return status === 404 && body.vercelError === "DEPLOYMENT_NOT_FOUND" ? "alias_absent" : "unexpected";
  }
  if (leaksOwnerGate(body) || leaksContract(name, body)) return "contract_leak";
  if (name === "conduit_health" || name === "conduit_ready") {
    const ready = name === "conduit_ready";
    const ok =
      status === 200 &&
      body.version === "0.8.0" &&
      body.contractRevision === HEALTH_CONTRACT_REVISION &&
      (!ready || body.persistence === "postgres");
    return ok ? "conduit_ready" : "unexpected";
  }
  const missing = body.missingRequired;
  const ownerGate =
    status === 503 &&
    Array.isArray(missing) &&
    missing.length === 1 &&
    missing[0] === OWNER_SECRET &&
    body.ownerActionRequired === undefined &&
    body.contractRevision === undefined;
  return ownerGate ? "resonance_owner_gate" : "unexpected";
}

export function admitWork(input: {
  kind: AdmissionKind;
  openWitnessPulls: number;
  pullNumber?: number;
}): Admission {
  if (input.pullNumber !== undefined && (KEEP_RED_PULLS as readonly number[]).includes(input.pullNumber)) {
    return { admit: false, reason: "keep_red_refused" };
  }
  if (input.kind === "owner") return { admit: false, reason: "owner_action_is_not_an_agent_pr" };
  if (input.kind === "witness" && input.openWitnessPulls >= WITNESS_BUDGET) {
    return { admit: false, reason: "witness_budget_spent" };
  }
  return { admit: true, reason: "implementation_allowed" };
}

export function bindingConstraint(classes: ProbeClass[]): "owner_secret" | "alias_absent" | "contract_leak" | "none" {
  if (classes.includes("contract_leak")) return "contract_leak";
  if (classes.includes("resonance_owner_gate")) return "owner_secret";
  if (classes.includes("alias_absent")) return "alias_absent";
  return "none";
}

function leaksOwnerGate(body: Record<string, unknown>): boolean {
  return "ownerActionRequired" in body && body.service === "resonance-nexus";
}

function leaksContract(name: ProbeName, body: Record<string, unknown>): boolean {
  return name === "resonance_ready" && "contractRevision" in body;
}
