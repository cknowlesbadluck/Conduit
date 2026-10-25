import type { NextFunction, Request, Response } from "express";

/**
 * Terminal Express error handler. Fail-closed: never echoes error messages or
 * stacks to the client (Express's default handler prints stacks outside
 * NODE_ENV=production). Only well-known body-parser 4xx statuses are preserved;
 * everything else becomes a generic 500.
 */
const CLIENT_ERRORS: Record<string, { status: number; code: string }> = {
  "entity.parse.failed": { status: 400, code: "invalid_json" },
  "entity.too.large": { status: 413, code: "payload_too_large" },
  "encoding.unsupported": { status: 415, code: "unsupported_encoding" },
  "charset.unsupported": { status: 415, code: "unsupported_charset" },
  "request.aborted": { status: 400, code: "request_aborted" },
  "request.size.invalid": { status: 400, code: "invalid_request_size" },
};

export function classifyHttpError(error: unknown): { status: number; code: string } {
  const fallback = { status: 500, code: "internal_error" };
  if (typeof error !== "object" || error === null) return fallback;
  let type: unknown;
  let status: unknown;
  try {
    // Accessors may throw; an unreadable error is treated as unknown (generic 500), never rethrown.
    type = (error as { type?: unknown }).type;
    status = (error as { status?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
  } catch { return fallback; }
  if (typeof type !== "string" || !Object.hasOwn(CLIENT_ERRORS, type)) return fallback;
  const mapped = CLIENT_ERRORS[type]!;
  // Only trust the allow-listed mapping when the status matches what body-parser assigns for that type.
  return status === mapped.status ? mapped : fallback;
}

export function jsonErrorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) { next(error); return; }
  const { status, code } = classifyHttpError(error);
  if (status >= 500) console.error("Unhandled request error", error);
  res.status(status).type("application/json").set("Cache-Control", "no-store").send(JSON.stringify({ error: code }));
}
