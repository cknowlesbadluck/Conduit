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

export interface ProbeTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const realTimers: ProbeTimers = {
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    // Never keep the event loop alive just for a readiness probe.
    t.unref?.();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Single-flight, time-bounded probe. Concurrent callers share one in-flight
 * query (so a burst of /ready hits cannot queue N probes on a max:1 pool), and
 * the timeout timer is always cleared once the race settles.
 */
export function createPersistenceProbe(
  runQuery: () => Promise<unknown>,
  timeoutMs: number = PROBE_TIMEOUT_MS,
  timers: ProbeTimers = realTimers,
): () => Promise<boolean> {
  let inflight: Promise<boolean> | undefined;
  return () => {
    if (inflight) return inflight;
    let handle: unknown;
    const timeout = new Promise<never>((_, reject) => {
      handle = timers.setTimeout(() => reject(new Error("persistence_probe_timeout")), timeoutMs);
    });
    const run = (async () => {
      try {
        await Promise.race([runQuery(), timeout]);
        return true;
      } catch {
        return false;
      } finally {
        timers.clearTimeout(handle);
        inflight = undefined;
      }
    })();
    inflight = run;
    return run;
  };
}

const probe = createPersistenceProbe(() => getProbePool().query("SELECT 1"));

export async function checkPersistence(): Promise<boolean> {
  if (!persistenceConfigured()) return true;
  return probe();
}
