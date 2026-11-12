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

/**
 * Race a promise against a timeout and always clear the timer, so repeated /ready
 * probes do not leave live timers behind.
 */
export async function raceWithTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("persistence_probe_timeout")), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkPersistence(): Promise<boolean> {
  if (!persistenceConfigured()) return true;
  try {
    await raceWithTimeout(getProbePool().query("SELECT 1"), PROBE_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}
