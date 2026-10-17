import type { Request, RequestHandler } from "express";
import type { ConduitAuthConfig } from "./auth.js";
import { resolveDiagnosticsTarget, runDiagnostics } from "./diagnostics.js";
import { DIAGNOSTICS_RATE_LIMITER } from "./rate-limit.js";

function diagnosticsTargetFor(req: Request, authConfig?: ConduitAuthConfig): string {
  return resolveDiagnosticsTarget({
    authConfig,
    publicUrl: process.env.PUBLIC_URL,
    requestHost: req.get("host"),
    requestProto: req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol,
    localPort: req.socket.localPort,
  });
}

type DiagnosticsRunner = typeof runDiagnostics;
export interface DiagnosticsHandlerOptions { cacheTtlMs?: number; run?: DiagnosticsRunner; now?: () => number }

const DEFAULT_CACHE_TTL_MS = Number(process.env.CONDUIT_DIAGNOSTICS_CACHE_MS ?? 30_000);

/**
 * Rate-limited HTTP `/diagnostics` handler with a validated probe target.
 * Results are cached per target for a short TTL so unauthenticated callers cannot
 * trigger fresh outbound probe fan-out on every request; the per-IP limiter still runs first.
 */
export function createDiagnosticsHandler(authConfig?: ConduitAuthConfig, options: DiagnosticsHandlerOptions = {}): RequestHandler {
  const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const run = options.run ?? runDiagnostics;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; body: unknown }>();
  return async (req, res, next) => {
    const limit = DIAGNOSTICS_RATE_LIMITER.check(`diagnostics:${req.ip ?? "unknown"}`);
    if (!limit.allowed) {
      res.set("Retry-After", String(Math.ceil(limit.retryAfterMs / 1000)));
      res.status(429).json({ error: "rate_limited", retryAfterMs: limit.retryAfterMs });
      return;
    }
    let target: string;
    try {
      target = diagnosticsTargetFor(req, authConfig);
    } catch {
      res.status(400).json({ error: "diagnostics_target_not_allowed" });
      return;
    }
    const cached = cache.get(target);
    if (cached && ttlMs > 0 && now() - cached.at < ttlMs) {
      res.set("X-Conduit-Diagnostics-Cache", "hit");
      res.json(cached.body);
      return;
    }
    try {
      const body = await run(authConfig, target);
      if (ttlMs > 0) cache.set(target, { at: now(), body });
      res.set("X-Conduit-Diagnostics-Cache", "miss");
      res.json(body);
    } catch (error) {
      next(error);
    }
  };
}
