#!/usr/bin/env node
/**
 * Ready posture pins: read-only, zero-dependency, fail-closed.
 *
 * portfolio-probe.mjs pins contractRevision / missingRequired / shape. This pins the
 * *posture* fields the owner relies on (version, persistence, production, auth mode,
 * persistenceConfigured, posture). Any mismatch, missing field, non-JSON body, or
 * unreachable plane is a failure. Cold-start 502/503/504 are retried with backoff
 * (10/20/30/45 s by default). No credentials are sent, read or printed.
 *
 * Usage: node scripts/ready-pins.mjs [--json]   exit 0 only when every pin matches.
 * Updating a pin is a deliberate, reviewed change to READY_PINS.
 */
export const READY_PINS = Object.freeze([
  Object.freeze({ name: "conduit", url: "https://conduit-feco.onrender.com/ready",
    pins: Object.freeze({ status: "ready", service: "conduit", version: "0.8.0", persistence: "postgres", production: true }) }),
  Object.freeze({ name: "resonance", url: "https://resonancenexus.netlify.app/api/ready",
    pins: Object.freeze({ status: "ready", service: "resonance-nexus", production: true, authMode: "required", authModeOk: true, persistenceConfigured: true, posture: "contract_passed", missingRequired: [] }) }),
]);

const COLD_START = new Set([502, 503, 504]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Pure: compare a parsed body with pins. Missing or different => mismatch. */
export function checkPins(pins, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [{ field: "*", expected: "object", actual: body === undefined ? "absent" : typeof body }];
  const out = [];
  for (const [field, expected] of Object.entries(pins)) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) out.push({ field, expected, actual: "absent" });
    else if (!same(body[field], expected)) out.push({ field, expected, actual: body[field] });
  }
  return out;
}

export async function probePin(target, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), backoffMs = [10_000, 20_000, 30_000, 45_000], timeoutMs = 60_000 } = {}) {
  let status = null;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchImpl(target.url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      status = res.status;
      if (COLD_START.has(status) && attempt < backoffMs.length) { await sleep(backoffMs[attempt]); continue; }
      if (status !== 200) return { name: target.name, ok: false, status, reason: `http_${status}`, mismatches: [] };
      let body;
      try { body = JSON.parse(await res.text()); } catch { return { name: target.name, ok: false, status, reason: "non_json", mismatches: [] }; }
      const mismatches = checkPins(target.pins, body);
      return { name: target.name, ok: mismatches.length === 0, status, reason: mismatches.length ? "pin_mismatch" : "pinned", mismatches };
    } catch {
      if (attempt < backoffMs.length) { await sleep(backoffMs[attempt]); continue; }
      return { name: target.name, ok: false, status, reason: "unreachable", mismatches: [] };
    }
  }
}

/** Fails closed: an empty target list is not ok. */
export async function probePins(targets = READY_PINS, options) {
  const results = await Promise.all(targets.map((t) => probePin(t, options)));
  return { ok: results.length > 0 && results.every((r) => r.ok), results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await probePins();
  if (process.argv.includes("--json")) console.log(JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2));
  else for (const r of report.results) console.log(r.name, r.ok ? "OK" : "FAIL", r.reason, r.mismatches.length ? JSON.stringify(r.mismatches) : "");
  process.exitCode = report.ok ? 0 : 1;
}
