import type { ConnectionConfig } from "pg";

/**
 * Postgres TLS for Conduit pools.
 *
 * DATABASE_SSL=false disables TLS.
 * Otherwise TLS is on. Certificate verification is ON by default.
 * Set DATABASE_SSL_REJECT_UNAUTHORIZED=false only for managed hosts
 * that present certificates Node cannot verify (common on Render).
 */
export function postgresSsl(): ConnectionConfig["ssl"] {
  if (process.env.DATABASE_SSL === "false") return false;
  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false";
  return { rejectUnauthorized };
}
