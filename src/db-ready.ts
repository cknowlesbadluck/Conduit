import pg from "pg";

const PROBE_TIMEOUT_MS = 2000;

let probePool: pg.Pool | undefined;

function persistenceConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL) && process.env.CONDUIT_TEST_MEMORY !== "true";
}

function getProbePool(): pg.Pool {
  if (!probePool) {
    probePool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
      max: 1,
      connectionTimeoutMillis: PROBE_TIMEOUT_MS,
      idleTimeoutMillis: 10_000,
    });
  }
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
