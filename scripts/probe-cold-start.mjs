/**
 * Classify a sequence of /ready probe attempts (oldest first) as cold_start vs down.
 * Free-tier hosts (Render) answer 503 / time out while spinning up, then 200 on retry.
 * Pure and read-only: no network, no env. Fail closed: anything not proven ready is not ok.
 *
 * attempt: { status?: number, error?: "timeout"|string, latencyMs?: number }
 * Returns { classification, ok, attempts, firstOkAttempt }
 *   ready       - first attempt 200
 *   cold_start  - >=1 transient failure (503/502/504/timeout/unreachable) then 200
 *   down        - no 200 and every attempt transient
 *   error       - no 200 and some non-transient status (e.g. 500, 404)
 *   unknown     - no attempts
 */
const TRANSIENT_STATUS = new Set([502, 503, 504]);

export function isTransient(a) {
  if (!a || typeof a !== "object") return false;
  if (a.error) return true;
  return TRANSIENT_STATUS.has(a.status);
}

export function classifyAttempts(attempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  if (list.length === 0) return { classification: "unknown", ok: false, attempts: 0, firstOkAttempt: null };
  const idx = list.findIndex((a) => a && !a.error && a.status === 200);
  if (idx === 0) return { classification: "ready", ok: true, attempts: list.length, firstOkAttempt: 1 };
  if (idx > 0) {
    const before = list.slice(0, idx);
    if (before.every(isTransient)) return { classification: "cold_start", ok: true, attempts: list.length, firstOkAttempt: idx + 1 };
    return { classification: "error", ok: false, attempts: list.length, firstOkAttempt: idx + 1 }; // flapping via a hard error
  }
  return { classification: list.every(isTransient) ? "down" : "error", ok: false, attempts: list.length, firstOkAttempt: null };
}
