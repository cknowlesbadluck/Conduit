import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";
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
 * TLS (folded in from #155) is **verified by default**:
 * - `DATABASE_SSL=false`                     disable TLS entirely (local / CI Postgres only).
 * - `DATABASE_SSL_CA`                        PEM CA bundle (literal `\n` escapes accepted).
 * - `DATABASE_SSL_CA_FILE`                   path to a PEM CA bundle (used if DATABASE_SSL_CA unset).
 * - `PGSSL_ALLOW_INSECURE=true`              explicit opt-out: encrypt but do NOT verify.
 * - `DATABASE_SSL_REJECT_UNAUTHORIZED=false` legacy spelling of the same opt-out.
 * DEPLOY NOTE: production must set DATABASE_SSL_CA (or the explicit opt-out) before this ships.
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

export type DatabaseSslOption = false | ConnectionOptions;

export function sslOption(env: NodeJS.ProcessEnv = process.env): DatabaseSslOption {
  if (env.DATABASE_SSL?.trim().toLowerCase() === "false") return false;
  const insecure =
    env.PGSSL_ALLOW_INSECURE?.trim().toLowerCase() === "true" ||
    env.DATABASE_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() === "false";
  if (insecure) return { rejectUnauthorized: false };
  const ca = readCa(env);
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

/** Back-compat alias used by #155's tests. */
export const databaseSslOption = sslOption;

function readCa(env: NodeJS.ProcessEnv): string | undefined {
  const inline = env.DATABASE_SSL_CA?.trim();
  if (inline) return inline.includes("\\n") ? inline.replace(/\\n/g, "\n") : inline;
  const file = env.DATABASE_SSL_CA_FILE?.trim();
  if (file) return readFileSync(file, "utf8");
  return undefined;
}

let warnedInsecure = false;

function warnIfInsecure(ssl: DatabaseSslOption): void {
  if (ssl && ssl.rejectUnauthorized === false && !warnedInsecure) {
    warnedInsecure = true;
    console.warn("Postgres TLS certificate verification is DISABLED (PGSSL_ALLOW_INSECURE / DATABASE_SSL_REJECT_UNAUTHORIZED=false). Set DATABASE_SSL_CA instead.");
  }
}

/** A dedicated (non-shared) pool with the shared TLS policy, e.g. the /ready probe pool. Null in memory mode. */
export function createPgPool(options: Omit<pg.PoolConfig, "connectionString" | "ssl"> = {}): pg.Pool | null {
  if (!databaseConfigured()) return null;
  const ssl = sslOption();
  warnIfInsecure(ssl);
  return new pg.Pool({ ...options, connectionString: process.env.DATABASE_URL, ssl });
}

export function poolConfig(env: NodeJS.ProcessEnv = process.env): pg.PoolConfig {
  return { connectionString: env.DATABASE_URL, ssl: sslOption(env), max: poolMax(env), connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS };
}

let shared: pg.Pool | null | undefined;

/** The shared pool, created on first use; null when persistence is not configured (memory mode). */
export function getSharedPool(): pg.Pool | null {
  if (shared === undefined) {
    if (databaseConfigured()) {
      const config = poolConfig();
      warnIfInsecure(config.ssl as DatabaseSslOption);
      shared = new pg.Pool(config);
    } else shared = null;
  }
  return shared;
}

/** Graceful shutdown hook; safe to call when no pool was ever created. */
export async function closeSharedPool(): Promise<void> {
  const pool = shared;
  shared = undefined;
  if (pool) await pool.end();
}
