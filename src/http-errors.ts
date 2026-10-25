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
  const type = typeof error === "object" && error !== null ? (error as { type?: unknown }).type : undefined;
  if (typeof type === "string" && Object.hasOwn(CLIENT_ERRORS, type)) return CLIENT_ERRORS[type]!;
  return { status: 500, code: "internal_error" };
}

export function jsonErrorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) { next(error); return; }
  const { status, code } = classifyHttpError(error);
  if (status >= 500) console.error("Unhandled request error", error);
  res.status(status).type("application/json").set("Cache-Control", "no-store").send(JSON.stringify({ error: code }));
}
