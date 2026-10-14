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
