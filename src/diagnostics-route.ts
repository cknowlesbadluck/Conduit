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

/** Rate-limited HTTP `/diagnostics` handler with a validated probe target. */
export function createDiagnosticsHandler(authConfig?: ConduitAuthConfig): RequestHandler {
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
    try {
      res.json(await runDiagnostics(authConfig, target));
    } catch (error) {
      next(error);
    }
  };
}
