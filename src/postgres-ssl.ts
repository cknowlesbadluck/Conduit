import type pg from "pg";

export type PostgresSsl = false | { rejectUnauthorized: boolean };

/** Single SSL policy for every Postgres pool. Default remains compatible with current Render TLS; verify is opt-in. */
export function postgresSsl(env: NodeJS.ProcessEnv = process.env): PostgresSsl {
  if (env.DATABASE_SSL === "false") return false;
  return { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" };
}

export function postgresTlsReport(env: NodeJS.ProcessEnv = process.env) {
  const ssl = postgresSsl(env);
  return {
    mode: ssl === false ? "disabled" as const : "required" as const,
    verify: ssl !== false && ssl.rejectUnauthorized,
  };
}

export function postgresPoolConfig(connectionString: string, extra: Omit<pg.PoolConfig, "connectionString" | "ssl"> = {}, env: NodeJS.ProcessEnv = process.env): pg.PoolConfig {
  return { connectionString, ssl: postgresSsl(env), ...extra };
}
