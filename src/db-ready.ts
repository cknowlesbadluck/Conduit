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
