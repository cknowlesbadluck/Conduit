/**
 * Express "trust proxy" setting so per-IP rate limits key on the real client, not the platform proxy.
 * CONDUIT_TRUST_PROXY: a hop count (0-10) or "false". Default: 1 hop when running on Render
 * (Cloudflare + Render LB append the client to X-Forwarded-For; trust only the last hop), otherwise false.
 * Never `true`: trusting every hop lets clients spoof req.ip via a forged X-Forwarded-For.
 */
export function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env): number | false {
  const raw = env.CONDUIT_TRUST_PROXY?.trim();
  if (raw) {
    if (raw === "false" || raw === "0") return false;
    if (/^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 10) return Number(raw);
    throw new Error("CONDUIT_TRUST_PROXY must be a hop count between 0 and 10 or 'false'");
  }
  return env.RENDER?.trim() ? 1 : false;
}
