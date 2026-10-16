/** Fail fast instead of hanging forever when Postgres is unreachable (pg's default connect timeout is 0 = never). */
export const DATABASE_CONNECT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 10_000);
  return Number.isFinite(raw) && raw >= 1000 ? raw : 10_000;
})();
/** Upper bound for the OAuth discovery fetch at startup. */
export const AUTH_DISCOVERY_TIMEOUT_MS = 10_000;
