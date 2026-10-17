import type { ErrorRequestHandler } from "express";

/**
 * Terminal JSON error handler. Without it Express's default finalhandler renders
 * an HTML page that includes err.stack whenever NODE_ENV !== "production", so
 * stack exposure depended on NODE_ENV alone (same class of issue as the
 * production lockdown in runtime.ts). This handler never echoes stack, message
 * or request content:
 *  - malformed JSON (body-parser `entity.parse.failed`) -> 400 (JSON-RPC -32700 on /mcp)
 *  - body over MAX_JSON_BODY (`entity.too.large`) -> 413
 *  - other 4xx from body-parser -> that status with a generic code
 *  - anything else -> 500 `internal_error`, logged server-side by name only
 */
export const jsonErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const status = httpStatusOf(error);
  const type = typeof (error as { type?: unknown })?.type === "string" ? (error as { type: string }).type : undefined;
  let code = "internal_error";
  if (type === "entity.parse.failed") code = "invalid_json";
  else if (type === "entity.too.large") code = "payload_too_large";
  else if (status < 500) code = "bad_request";

  if (status >= 500) {
    const name = error instanceof Error ? error.name : typeof error;
    console.error(`Unhandled request error on ${req.method} ${req.path}: ${name}`);
  }
  if (code === "invalid_json" && req.path === "/mcp") {
    res.status(400).json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
    return;
  }
  res.status(status).json({ error: code });
};

function httpStatusOf(error: unknown): number {
  const raw = (error as { status?: unknown; statusCode?: unknown } | null | undefined);
  const status = typeof raw?.status === "number" ? raw.status : typeof raw?.statusCode === "number" ? raw.statusCode : 500;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}
