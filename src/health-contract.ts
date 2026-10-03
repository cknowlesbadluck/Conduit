import { VERSION } from "./version.js";

/** Stamp that proves /health and /ready are the same contract generation. */
export const HEALTH_CONTRACT_REVISION = "2026-10-03-health-parity";

export type HealthBody = {
  status: "ok";
  service: "conduit";
  version: string;
  contractRevision: string;
};

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
