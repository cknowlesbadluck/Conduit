import { readFileSync } from "node:fs";
import pg from "pg";
import type { ConnectionOptions } from "node:tls";

/**
 * Single source of truth for Postgres TLS and pool construction.
 *
 * TLS is **verified by default**. Environment:
 * - `DATABASE_SSL=false`              — disable TLS entirely (local / CI Postgres only).
 * - `DATABASE_SSL_CA`                 — PEM CA bundle (literal `\n` escapes are accepted).
 * - `DATABASE_SSL_CA_FILE`            — path to a PEM CA bundle (used if `DATABASE_SSL_CA` is unset).
 * - `PGSSL_ALLOW_INSECURE=true`       — explicit opt-out: encrypt but do NOT verify the server certificate.
 * - `DATABASE_SSL_REJECT_UNAUTHORIZED=false` — legacy spelling of the same opt-out.
 */
export type DatabaseSslOption = false | ConnectionOptions;

export function databaseSslOption(env: NodeJS.ProcessEnv = process.env): DatabaseSslOption {
  if (env.DATABASE_SSL?.trim().toLowerCase() === "false") return false;

  const insecure =
    env.PGSSL_ALLOW_INSECURE?.trim().toLowerCase() === "true" ||
    env.DATABASE_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() === "false";
  if (insecure) return { rejectUnauthorized: false };

  const ca = readCa(env);
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

function readCa(env: NodeJS.ProcessEnv): string | undefined {
  const inline = env.DATABASE_SSL_CA?.trim();
  if (inline) return inline.includes("\\n") ? inline.replace(/\\n/g, "\n") : inline;
  const file = env.DATABASE_SSL_CA_FILE?.trim();
  if (file) return readFileSync(file, "utf8");
  return undefined;
}

let warnedInsecure = false;

export function databaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATABASE_URL) && env.CONDUIT_TEST_MEMORY !== "true";
}

/** Create a pg pool with the shared TLS policy. Returns null when persistence is not configured. */
export function createPgPool(options: Omit<pg.PoolConfig, "connectionString" | "ssl"> = {}): pg.Pool | null {
  if (!databaseConfigured()) return null;
  const ssl = databaseSslOption();
  if (ssl && ssl.rejectUnauthorized === false && !warnedInsecure) {
    warnedInsecure = true;
    console.warn("Postgres TLS certificate verification is DISABLED (PGSSL_ALLOW_INSECURE / DATABASE_SSL_REJECT_UNAUTHORIZED=false). Set DATABASE_SSL_CA instead.");
  }
  return new pg.Pool({ ...options, connectionString: process.env.DATABASE_URL, ssl });
}
