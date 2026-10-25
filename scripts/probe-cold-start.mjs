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
const TRANSIENT_ERRORS = new Set(["timeout", "unreachable"]);

function isHard(a) {
  return !!a && typeof a === "object" && !isTransient(a) && !(a.status === 200 && !a.error);
}

export function isTransient(a) {
  if (!a || typeof a !== "object") return false;
  // A hard HTTP status wins over any reported error (e.g. { status: 500, error: "timeout" }).
  if (typeof a.status === "number" && a.status !== 0 && !TRANSIENT_STATUS.has(a.status)) return false;
  if (TRANSIENT_STATUS.has(a.status)) return true;
  return typeof a.error === "string" && TRANSIENT_ERRORS.has(a.error);
}

export function classifyAttempts(attempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  if (list.length === 0) return { classification: "unknown", ok: false, attempts: 0, firstOkAttempt: null };
  // Fail closed: any hard (non-transient, non-200) attempt anywhere in the sequence is an error,
  // even after a 200 (e.g. 200 then 500 must never read as healthy).
  if (list.some(isHard)) {
    const okIdx = list.findIndex((a) => a && !a.error && a.status === 200);
    return { classification: "error", ok: false, attempts: list.length, firstOkAttempt: okIdx >= 0 ? okIdx + 1 : null };
  }
  const idx = list.findIndex((a) => a && !a.error && a.status === 200);
  if (idx === 0) return { classification: "ready", ok: true, attempts: list.length, firstOkAttempt: 1 };
  if (idx > 0) {
    const before = list.slice(0, idx);
    if (before.every(isTransient)) return { classification: "cold_start", ok: true, attempts: list.length, firstOkAttempt: idx + 1 };
    return { classification: "error", ok: false, attempts: list.length, firstOkAttempt: idx + 1 }; // flapping via a hard error
  }
  return { classification: list.every(isTransient) ? "down" : "error", ok: false, attempts: list.length, firstOkAttempt: null };
}
