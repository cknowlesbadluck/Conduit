/**
 * CONDUIT_TEST_MEMORY is a test-only switch: it silently replaces Postgres
 * with process memory even when DATABASE_URL is set, so records vanish on
 * restart. In production that is a fail-open, so refuse to boot.
 * Postgres stays optional: production without DATABASE_URL is unaffected.
 */
export function persistenceConfigError(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_ENV === "production" && env.CONDUIT_TEST_MEMORY !== undefined && env.CONDUIT_TEST_MEMORY !== "") {
    return "CONDUIT_TEST_MEMORY is test-only and must not be set when NODE_ENV=production";
  }
  return null;
}

export function assertPersistenceConfig(env: NodeJS.ProcessEnv = process.env): void {
  const error = persistenceConfigError(env);
  if (error) throw new Error(error);
}
