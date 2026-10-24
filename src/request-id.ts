import crypto from "node:crypto";

/** Accept only a short, log-safe caller request id; anything else gets a fresh UUID. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,80}$/;

export function resolveRequestId(header: string | undefined): string {
  return header && SAFE_REQUEST_ID.test(header) ? header : crypto.randomUUID();
}
