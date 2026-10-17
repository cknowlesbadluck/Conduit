import pg from "pg";
import { DATABASE_CONNECT_TIMEOUT_MS } from "./db-timeouts.js";

/**
 * One process-wide Postgres pool shared by store.ts, capability-store.ts and binding-subjects.ts.
 *
 * Before this module each of those files opened its own pool (5 + 3 + 2 = 10 connections per
 * instance, with inconsistent TLS settings). A single pool keeps the per-instance connection
 * budget explicit (DATABASE_POOL_MAX, default 10, clamped to 1..50) and lets idle capacity be
 * shared instead of stranded in whichever store is quiet.
 *
 * The /ready probe pool in db-ready.ts stays separate on purpose: readiness must not report
 * "not ready" just because the work pool is saturated, and must not queue behind it.
 *
 * TLS: DATABASE_SSL=false disables TLS; otherwise certificates are verified only when
 * DATABASE_SSL_REJECT_UNAUTHORIZED=true. That matches what store.ts and binding-subjects.ts
 * already did, and the capability store's previous hard-coded rejectUnauthorized:false is the
 * same default, so no deployed behaviour changes.
 */
export const DEFAULT_POOL_MAX = 10;

export function databaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATABASE_URL) && env.CONDUIT_TEST_MEMORY !== "true";
}

export function poolMax(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.DATABASE_POOL_MAX);
  if (env.DATABASE_POOL_MAX === undefined || !Number.isFinite(raw)) return DEFAULT_POOL_MAX;
  return Math.min(50, Math.max(1, Math.floor(raw)));
}

export function sslOption(env: NodeJS.ProcessEnv = process.env): false | { rejectUnauthorized: boolean } {
  return env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" };
}

export function poolConfig(env: NodeJS.ProcessEnv = process.env): pg.PoolConfig {
  return { connectionString: env.DATABASE_URL, ssl: sslOption(env), max: poolMax(env), connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS };
}

let shared: pg.Pool | null | undefined;

/** The shared pool, created on first use; null when persistence is not configured (memory mode). */
export function getSharedPool(): pg.Pool | null {
  if (shared === undefined) shared = databaseConfigured() ? new pg.Pool(poolConfig()) : null;
  return shared;
}

/** Graceful shutdown hook; safe to call when no pool was ever created. */
export async function closeSharedPool(): Promise<void> {
  const pool = shared;
  shared = undefined;
  if (pool) await pool.end();
}
