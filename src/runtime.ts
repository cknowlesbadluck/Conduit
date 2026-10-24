/**
 * Production-runtime detection for security fences (dev-only auth modes, HTTPS requirements).
 * Fail-closed: any one signal is enough. NODE_ENV alone is too easy to leave unset on a host,
 * so well-known hosting markers and an explicit CONDUIT_PRODUCTION flag also count.
 * Provider-neutral: RENDER, FLY_APP_NAME, RAILWAY_ENVIRONMENT, VERCEL and K_SERVICE are read only as presence markers.
 */
const HOST_MARKERS = ["RENDER", "FLY_APP_NAME", "RAILWAY_ENVIRONMENT", "VERCEL", "K_SERVICE"] as const;

export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production") return true;
  if (env.CONDUIT_PRODUCTION === "true") return true;
  return HOST_MARKERS.some((name) => Boolean(env[name]?.trim()));
}

/**
 * Development-only behavior (CONDUIT_TOKEN static bearer, CONDUIT_ALLOW_ANONYMOUS, plain-HTTP auth URLs)
 * requires an explicit opt-in AND no production signal. An unidentified runtime is NOT development.
 * Opt in locally with CONDUIT_DEV_MODE=true, or NODE_ENV=development|test.
 */
export function isDevelopmentRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isProductionRuntime(env)) return false;
  return env.CONDUIT_DEV_MODE === "true" || env.NODE_ENV === "development" || env.NODE_ENV === "test";
}
