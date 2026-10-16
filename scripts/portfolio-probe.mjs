#!/usr/bin/env node
/**
 * Portfolio probe — free, zero-dependency, read-only, fail-closed.
 *
 * Fetches each known public endpoint (no credentials are sent, read, or printed) and
 * classifies the outcome:
 *   ready | not_ready (+ missing list) | challenge | stranger_occupant | alias_absent | unreachable | timeout | unknown
 * `challenge` = a CDN bot challenge (Cloudflare `cf-mitigated: challenge` / "Just a moment..."
 * interstitial) answered instead of the origin: we cannot see the service, so it is NOT ok.
 * Only `ready` counts as ok. Anything unrecognised is `unknown` and NOT ok.
 *
 * Drift (pinned expectations, fail-closed): a target may pin `expect.contractRevision` and/or
 * `expect.missingRequired` (the exact owner-gated set). Then:
 *   - ready with a different/absent contractRevision  -> outcome `contract_changed` (drift)
 *   - not_ready whose missing set != the pinned set    -> outcome `regression` (drift)
 *   - not_ready matching the pinned set exactly        -> `not_ready`, drift=false (known owner gate)
 * Every result carries `drift: boolean`; anything unclassifiable is drift=true.
 *
 * Usage: node scripts/portfolio-probe.mjs [--json] [--drift-only]
 *   default: exit 1 if any target is not ok; --drift-only: exit 1 only if any pinned target drifted.
 */

export const TARGETS = [
  { name: "conduit", url: "https://conduit-feco.onrender.com/ready", expectService: "conduit", expect: { contractRevision: "2026-10-03-ready-surface" } },
  // Owner gate: the service role key is the ONLY thing Resonance prod may be missing.
  { name: "resonance-netlify", url: "https://resonancenexus.netlify.app/api/ready", expectService: "resonance-nexus", expect: { missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"] } },
  { name: "resonance-vercel", url: "https://resonance.vercel.app/api/ready", expectService: "resonance-nexus" },
  { name: "resonancenexus-vercel", url: "https://resonancenexus.vercel.app/api/ready", expectService: "resonance-nexus" },
  { name: "quicksilver-vercel", url: "https://quicksilver.vercel.app/", expectService: "quicksilver" },
  { name: "quicksilverv1-vercel", url: "https://quicksilverv1.vercel.app/", expectService: "quicksilver" },
];

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Pure classifier. `observation` is either { error: "timeout" | "unreachable" } or
 * { status, headers: { [lowercase]: string }, body: string }.
 */
export function classify(target, observation) {
  return withDrift(target, classifyRaw(target, observation));
}

function sameSet(a, b) {
  const sa = [...new Set(a)].sort(), sb = [...new Set(b)].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

/** Compare a raw classification with pinned expectations. Fail-closed: no pin match = drift. */
export function withDrift(target, r) {
  const expect = target.expect;
  if (!expect) return { ...r, drift: !r.ok };
  if (r.outcome === "ready") {
    if (expect.contractRevision !== undefined && r.contractRevision !== expect.contractRevision) {
      return { ...r, outcome: "contract_changed", ok: false, drift: true, expectedContractRevision: expect.contractRevision };
    }
    if (expect.missingRequired?.length) return { ...r, drift: true, reason: "owner_gate_cleared_update_pin" };
    return { ...r, drift: false };
  }
  if (r.outcome === "not_ready" && Array.isArray(expect.missingRequired)) {
    if (!r.missingClean || !sameSet(r.missing, expect.missingRequired)) {
      return { ...r, outcome: "regression", drift: true, expectedMissing: [...expect.missingRequired], reason: r.missingClean ? "missing_set_changed" : "missing_list_malformed" };
    }
    return { ...r, drift: false, reason: "known_owner_gate" };
  }
  return { ...r, drift: true };
}

function classifyRaw(target, observation) {
  const base = { name: target.name, url: target.url };
  if (!observation || typeof observation !== "object") return { ...base, outcome: "unknown", ok: false, reason: "no_observation" };
  if (observation.error === "timeout") return { ...base, outcome: "timeout", ok: false };
  if (observation.error) return { ...base, outcome: "unreachable", ok: false };
  const { status, headers = {}, body = "" } = observation;
  const vercelError = String(headers["x-vercel-error"] ?? "");
  if (/challenge/i.test(String(headers["cf-mitigated"] ?? "")) || /challenges\.cloudflare\.com|<title>Just a moment\.\.\.<\/title>/i.test(body)) {
    return { ...base, outcome: "challenge", ok: false, status, reason: "cdn_bot_challenge" };
  }
  if (status === 404 && (/DEPLOYMENT_NOT_FOUND|NOT_FOUND/.test(vercelError) || /DEPLOYMENT_NOT_FOUND/.test(body))) {
    return { ...base, outcome: "alias_absent", ok: false, status };
  }
  let json;
  try { json = JSON.parse(body); } catch { json = undefined; }
  const service = json && typeof json === "object" ? json.service : undefined;
  if (status === 200) {
    if (service !== target.expectService) return { ...base, outcome: "stranger_occupant", ok: false, status, reason: service ? "service_mismatch" : "no_service_stamp" };
    if (json.status === "ready") return { ...base, outcome: "ready", ok: true, status, ...(json.version ? { version: String(json.version) } : {}), ...(json.contractRevision ? { contractRevision: String(json.contractRevision) } : {}) };
    return { ...base, outcome: "unknown", ok: false, status, reason: "200_without_ready" };
  }
  if (status === 503 && service === target.expectService && json.status === "not_ready") {
    // Only env-var *names* the server itself chose to publish; values are never seen.
    const raw = json.missingRequired;
    const missing = Array.isArray(raw) ? raw.filter((m) => typeof m === "string" && ENV_NAME.test(m)) : [];
    const missingClean = Array.isArray(raw) && missing.length === raw.length;
    return { ...base, outcome: "not_ready", ok: false, status, missing, missingClean };
  }
  if (status === 503 && body.trim() === "" && /cloudflare/i.test(String(headers.server ?? ""))) {
    return { ...base, outcome: "unknown", ok: false, status, reason: "edge_503_empty_origin_unavailable" };
  }
  if (status === 503 && service !== target.expectService && service !== undefined) return { ...base, outcome: "stranger_occupant", ok: false, status, reason: "service_mismatch" };
  return { ...base, outcome: "unknown", ok: false, status };
}

export async function observe(url, { timeoutMs = 20_000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // No Authorization/cookies: public endpoints only. redirect: "manual" so a hijacked
    // alias cannot bounce us somewhere else and look healthy.
    const res = await fetchImpl(url, { signal: controller.signal, redirect: "manual", headers: { accept: "application/json" } });
    const body = (await res.text()).slice(0, 16_384);
    return { status: res.status, headers: { "x-vercel-error": res.headers.get("x-vercel-error") ?? "", "cf-mitigated": res.headers.get("cf-mitigated") ?? "", server: res.headers.get("server") ?? "" }, body };
  } catch (error) {
    return { error: controller.signal.aborted || error?.name === "AbortError" ? "timeout" : "unreachable" };
  } finally { clearTimeout(timer); }
}

export async function probeAll(targets = TARGETS, options) {
  return Promise.all(targets.map(async (t) => classify(t, await observe(t.url, options))));
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const results = await probeAll();
  if (process.argv.includes("--json")) console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  else for (const r of results) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.name.padEnd(22)} ${r.outcome}${r.missing?.length ? ` missing=[${r.missing.join(",")}]` : ""}${r.reason ? ` reason=${r.reason}` : ""}${r.drift ? " DRIFT" : ""}${r.status ? ` (${r.status})` : ""}`);
  const pass = process.argv.includes("--drift-only") ? results.every((r) => !r.drift || !TARGETS.find((t) => t.name === r.name)?.expect) : results.every((r) => r.ok);
  process.exitCode = pass ? 0 : 1;
}
