import { VERSION } from "./version.js";

/** Stamp that proves /health and /ready are the same contract generation. */
export const HEALTH_CONTRACT_REVISION = "2026-10-03-ready-surface";

export type HealthBody = {
  status: "ok";
  service: "conduit";
  version: string;
  contractRevision: string;
};

export type PersistenceMode = "postgres" | "memory";

export type ReadyBody = {
  status: "ready" | "degraded" | "initializing";
  service: "conduit";
  version: string;
  contractRevision: string;
  persistence: PersistenceMode;
};

export type SurfaceSplit =
  | "aligned"
  | "ready_missing_stamp"
  | "health_missing_stamp"
  | "revision_mismatch"
  | "version_mismatch";

/**
 * Single health payload for Express, the app factory, and the worker fetch path.
 * A live 200 that omits version or contractRevision is not this contract.
 */
export function healthBody(): HealthBody {
  return {
    status: "ok",
    service: "conduit",
    version: VERSION,
    contractRevision: HEALTH_CONTRACT_REVISION,
  };
}

/**
 * Ready payload. Persistence mode is a label only; the caller decides it.
 * Never include DATABASE_URL or any other secret.
 */
export function readyBody(input: {
  initialized: boolean;
  persistenceOk: boolean;
  persistence: PersistenceMode;
}): ReadyBody {
  const ready = input.initialized && input.persistenceOk;
  return {
    status: ready ? "ready" : input.initialized ? "degraded" : "initializing",
    service: "conduit",
    version: VERSION,
    contractRevision: HEALTH_CONTRACT_REVISION,
    persistence: input.persistence,
  };
}

/** Classify a live health/ready pair. A 200 without the stamp is not aligned. */
export function classifySurfaceSplit(
  health: { version?: unknown; contractRevision?: unknown },
  ready: { version?: unknown; contractRevision?: unknown },
): SurfaceSplit {
  const healthRevision = health.contractRevision;
  const readyRevision = ready.contractRevision;
  if (typeof healthRevision === "string" && typeof readyRevision !== "string") return "ready_missing_stamp";
  if (typeof readyRevision === "string" && typeof healthRevision !== "string") return "health_missing_stamp";
  if (typeof healthRevision === "string" && typeof readyRevision === "string" && healthRevision !== readyRevision) {
    return "revision_mismatch";
  }
  if (typeof health.version === "string" && typeof ready.version === "string" && health.version !== ready.version) {
    return "version_mismatch";
  }
  return "aligned";
}
