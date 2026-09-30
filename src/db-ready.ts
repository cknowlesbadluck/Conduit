import pg from "pg";
import { createPgPool, databaseConfigured } from "./db-pool.js";

const PROBE_TIMEOUT_MS = 2000;

let probePool: pg.Pool | undefined;

function persistenceConfigured(): boolean {
  return databaseConfigured();
}

function getProbePool(): pg.Pool {
  if (!probePool) {
    probePool = createPgPool({
      max: 1,
      connectionTimeoutMillis: PROBE_TIMEOUT_MS,
      idleTimeoutMillis: 10_000,
    }) ?? undefined;
  }
  if (!probePool) throw new Error("persistence_not_configured");
  return probePool;
}

export async function checkPersistence(): Promise<boolean> {
  if (!persistenceConfigured()) return true;
  try {
    const query = getProbePool().query("SELECT 1");
    await Promise.race([
      query,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("persistence_probe_timeout")), PROBE_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}
