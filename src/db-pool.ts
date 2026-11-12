import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";
import pg from "pg";

/** One process-wide PostgreSQL pool shared by all persistence modules. */
export function databaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATABASE_URL) && env.CONDUIT_TEST_MEMORY !== "true";
}

export type DatabaseSslOption = false | ConnectionOptions;

/** Verify Postgres certificates by default; insecure TLS requires an explicit opt-out. */
export function sslOption(env: NodeJS.ProcessEnv = process.env): DatabaseSslOption {
  if (env.DATABASE_SSL?.trim().toLowerCase() === "false") return false;
  const insecure =
    env.PGSSL_ALLOW_INSECURE?.trim().toLowerCase() === "true" ||
    env.DATABASE_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() === "false";
  if (insecure) return { rejectUnauthorized: false };
  const ca = readCa(env);
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

export const databaseSslOption = sslOption;

export interface DatabaseConnectionConfig {
  connectionString: string | undefined;
  ssl: DatabaseSslOption;
}

/**
 * Remove node-postgres SSL query parameters before passing a config-level TLS
 * policy. node-postgres otherwise replaces the supplied ssl object when it
 * parses sslmode/sslrootcert/sslcert/sslkey from the URL.
 */
export function databaseConnectionConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConnectionConfig {
  if (!env.DATABASE_URL) return { connectionString: undefined, ssl: sslOption(env) };

  const url = new URL(env.DATABASE_URL);
  const rootCert = url.searchParams.get("sslrootcert");
  const clientCert = url.searchParams.get("sslcert");
  const clientKey = url.searchParams.get("sslkey");
  for (const parameter of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) {
    url.searchParams.delete(parameter);
  }

  const effectiveEnv = { ...env };
  if (!effectiveEnv.DATABASE_SSL_CA && !effectiveEnv.DATABASE_SSL_CA_FILE && rootCert) {
    effectiveEnv.DATABASE_SSL_CA_FILE = rootCert;
  }

  const ssl = sslOption(effectiveEnv);
  if (ssl && typeof ssl === "object") {
    if (clientCert) ssl.cert = readFileSync(clientCert, "utf8");
    if (clientKey) ssl.key = readFileSync(clientKey, "utf8");
  }

  return { connectionString: url.toString(), ssl };
}

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
    console.warn("Postgres TLS certificate verification is DISABLED. Set DATABASE_SSL_CA instead.");
  }
}

/** Create a dedicated pool with the same verified TLS policy and caller-owned sizing. */
export function createPgPool(options: Omit<pg.PoolConfig, "connectionString" | "ssl"> = {}): pg.Pool | null {
  if (!databaseConfigured()) return null;
  const connection = databaseConnectionConfig();
  warnIfInsecure(connection.ssl);
  return new pg.Pool({ ...options, ...connection });
}
