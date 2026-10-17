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
  /** Readiness gate this body describes. Portable readiness contract v1 field. */
  stage: "deployment";
  /** Names (never values) of required config keys that are absent. Portable readiness contract v1 field. */
  missingRequired: string[];
  /** Deployed git commit (Render's RENDER_GIT_COMMIT), or "unknown" when absent/malformed. */
  commitSha: string;
};

const COMMIT_SHA = /^[0-9a-f]{7,40}$/;

/** Portable readiness contract version this body conforms to (schemas/readiness/v1.schema.json). */
export const READINESS_CONTRACT_VERSION = "v1";

const CONFIG_KEY_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;

/**
 * Only well-formed config key names are ever reported, de-duplicated and sorted,
 * so a caller cannot accidentally reflect a value through missingRequired.
 */
export function sanitizeMissingRequired(names: readonly unknown[] | undefined): string[] {
  if (!names) return [];
  const keys = names.filter((name): name is string => typeof name === "string" && CONFIG_KEY_NAME.test(name));
  return [...new Set(keys)].sort();
}

/**
 * Deployed commit from Render's standard RENDER_GIT_COMMIT (not a secret).
 * Only a hex SHA is echoed; anything else (absent, empty, odd value) reports "unknown".
 */
export function deployedCommitSha(env: Record<string, string | undefined> | undefined = runtimeEnv()): string {
  const raw = env?.RENDER_GIT_COMMIT?.trim().toLowerCase();
  return raw && COMMIT_SHA.test(raw) ? raw : "unknown";
}

function runtimeEnv(): Record<string, string | undefined> | undefined {
  return typeof process === "undefined" ? undefined : process.env;
}

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
  commitSha?: string;
  missingRequired?: readonly string[];
}): ReadyBody {
  const missingRequired = sanitizeMissingRequired(input.missingRequired);
  const ready = input.initialized && input.persistenceOk && missingRequired.length === 0;
  return {
    status: ready ? "ready" : input.initialized ? "degraded" : "initializing",
    service: "conduit",
    version: VERSION,
    contractRevision: HEALTH_CONTRACT_REVISION,
    persistence: input.persistence,
    stage: "deployment",
    missingRequired,
    commitSha: input.commitSha ?? deployedCommitSha(),
  };
}

/** Classify a live health/ready pair. A 200 without the stamp is not aligned. */
export function classifySurfaceSplit(
  health: { version?: unknown; contractRevision?: unknown; [key: string]: unknown },
  ready: { version?: unknown; contractRevision?: unknown; [key: string]: unknown },
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
