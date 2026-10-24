/**
 * Read-only contract-revision skew check between Conduit and Resonance /ready payloads.
 * contractRevision values start with an ISO date (YYYY-MM-DD-<label>). Warn when the two
 * planes' revision dates differ by more than MAX_REVISION_SKEW_DAYS. Pure; no network, no env.
 */
export const MAX_REVISION_SKEW_DAYS = 14;

export function revisionDate(rev) {
  if (typeof rev !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(rev);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return t;
}

export function revisionSkew(results, { conduit = "conduit", resonance = "resonance-netlify", maxDays = MAX_REVISION_SKEW_DAYS } = {}) {
  const c = results.find((r) => r.name === conduit)?.contractRevision ?? null;
  const r = results.find((x) => x.name === resonance)?.contractRevision ?? null;
  const ct = revisionDate(c), rt = revisionDate(r);
  if (ct === null || rt === null) return { status: "unknown", conduit: c, resonance: r, skewDays: null, maxDays };
  const skewDays = Math.round(Math.abs(ct - rt) / 86_400_000);
  return { status: skewDays > maxDays ? "warn" : "ok", conduit: c, resonance: r, skewDays, maxDays };
}
