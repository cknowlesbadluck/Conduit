/**
 * CONDUIT_TEST_MEMORY is a test-only switch: it silently replaces Postgres
 * with process memory even when DATABASE_URL is set, so records vanish on
 * restart. Fail closed: the switch is honoured only when NODE_ENV=test;
 * any other environment (production, development, unset) refuses to boot.
 * Postgres stays optional: running without DATABASE_URL is unaffected.
 */
export function persistenceConfigError(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.CONDUIT_TEST_MEMORY !== undefined && env.CONDUIT_TEST_MEMORY !== "" && env.NODE_ENV !== "test") {
    return "CONDUIT_TEST_MEMORY is test-only and requires NODE_ENV=test";
  }
  return null;
}

export function assertPersistenceConfig(env: NodeJS.ProcessEnv = process.env): void {
  const error = persistenceConfigError(env);
  if (error) throw new Error(error);
}
