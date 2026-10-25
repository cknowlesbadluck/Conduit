/**
 * Cross-plane readiness verdict (pure, read-only: no network, no env, no imports).
 * Input: { planes: { [name]: { attempts: [...], expectedRevision?: string } }, now?: string|Date, maxAgeDays?: number|null }
 * Age alone is NOT drift: ageDays is informational. An age gate applies only when maxAgeDays is explicitly set (default off).
 * Per plane state:
 *   ready               - first attempt 200, production === true, contract fields present, revision well-formed (and matches expectedRevision if given)
 *   degraded_cold_start - one or more 502/503/504/timeout attempts, then 200 (otherwise ready)
 *   drift               - reached 200 but contractRevision is malformed/non-string, or != plane.expectedRevision,
 *                         or (only if maxAgeDays is set) older than maxAgeDays
 *   not_ready           - never 200, a hard error, production !== true, missing fields, or malformed input
 * Portfolio verdict = worst plane state (not_ready > drift > degraded_cold_start > ready). Fails closed: no planes = not_ready.
 */
export const STATES = ["ready", "degraded_cold_start", "drift", "not_ready"];
const SEVERITY = { ready: 0, degraded_cold_start: 1, drift: 2, not_ready: 3 };
const TRANSIENT_STATUS = new Set([502, 503, 504]);
const TRANSIENT_ERRORS = new Set(["timeout", "unreachable"]);
const REQUIRED = ["status", "service", "contractRevision", "production"];
const DAY_MS = 86_400_000;

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isOk = (a) => isObj(a) && a.status === 200 && !a.error;
const isTransient = (a) => isObj(a) && !isOk(a) && (TRANSIENT_STATUS.has(a.status) || ((a.status === undefined || a.status === 0) && TRANSIENT_ERRORS.has(a.error)));

/** Parse a contractRevision like "2026-10-03-ready-surface" to a UTC date (ms) or null. */
export function revisionDate(rev) {
  if (typeof rev !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[-_])/.exec(rev);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t : null;
}

export function classifyPlane(plane, { now = Date.now(), maxAgeDays = null, expectedRevision } = {}) {
  const out = (state, reason, extra = {}) => ({ state, reason, ...extra });
  if (!isObj(plane) || !Array.isArray(plane.attempts) || plane.attempts.length === 0) return out("not_ready", "malformed_or_no_attempts");
  const list = plane.attempts;
  if (!list.every(isObj)) return out("not_ready", "malformed_attempt");
  const idx = list.findIndex(isOk);
  if (idx < 0) return out("not_ready", "never_200", { attempts: list.length });
  if (!list.slice(0, idx).every(isTransient)) return out("not_ready", "hard_error_before_200", { attempts: list.length });
  if (list.slice(idx + 1).some((a) => !isOk(a))) return out("not_ready", "regressed_after_200", { attempts: list.length });
  const body = list[idx].body;
  if (!isObj(body)) return out("not_ready", "malformed_body");
  const missing = REQUIRED.filter((k) => !(k in body));
  if (missing.length) return out("not_ready", "missing_contract_fields", { missing });
  if (body.production !== true) return out("not_ready", "production_not_true");
  if (body.status !== "ready") return out("not_ready", "status_not_ready");
  const nowMs = now instanceof Date ? now.getTime() : typeof now === "string" ? Date.parse(now) : now;
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return out("not_ready", "invalid_now");
  if (maxAgeDays !== null && maxAgeDays !== undefined && !(Number.isFinite(maxAgeDays) && maxAgeDays >= 0)) return out("not_ready", "invalid_max_age");
  const expected = plane.expectedRevision ?? expectedRevision;
  if (expected !== undefined && typeof expected !== "string") return out("not_ready", "invalid_expected_revision");
  if (typeof body.service !== "string" || typeof body.contractRevision !== "string") return out("drift", "contract_shape_mismatch");
  const rev = revisionDate(body.contractRevision);
  if (rev === null) return out("drift", "unparseable_contract_revision");
  const ageDays = Math.floor((nowMs - rev) / DAY_MS);
  if (expected !== undefined && body.contractRevision !== expected) return out("drift", "contract_revision_mismatch", { expected, actual: body.contractRevision, ageDays });
  if (maxAgeDays !== null && maxAgeDays !== undefined && ageDays > maxAgeDays) return out("drift", "stale_contract_revision", { ageDays, maxAgeDays });
  if (idx > 0) return out("degraded_cold_start", "recovered_after_transient", { firstOkAttempt: idx + 1, ageDays });
  return out("ready", "ok", { ageDays });
}

export function portfolioVerdict(input) {
  if (!isObj(input) || !isObj(input.planes) || Object.keys(input.planes).length === 0) return { verdict: "not_ready", planes: {}, reason: "no_planes" };
  const opts = { now: input.now ?? Date.now(), maxAgeDays: input.maxAgeDays ?? null };
  const planes = {};
  let worst = "ready";
  for (const [name, p] of Object.entries(input.planes)) {
    planes[name] = classifyPlane(p, opts);
    if (SEVERITY[planes[name].state] > SEVERITY[worst]) worst = planes[name].state;
  }
  return { verdict: worst, planes };
}
