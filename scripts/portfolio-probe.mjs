#!/usr/bin/env node
/**
 * Portfolio probe — free, zero-dependency, read-only, fail-closed.
 *
 * Fetches each known public endpoint (no credentials are sent, read, or printed) and
 * classifies the outcome:
 *   ready | not_ready (+ missing list) | stranger_occupant | alias_absent | unreachable | timeout | unknown
 * Only `ready` counts as ok. Anything unrecognised is `unknown` and NOT ok.
 *
 * Usage: node scripts/portfolio-probe.mjs [--json]   (exit 1 if any target is not ok)
 */

export const TARGETS = [
  { name: "conduit", url: "https://conduit-feco.onrender.com/ready", expectService: "conduit" },
  { name: "resonance-netlify", url: "https://resonancenexus.netlify.app/api/ready", expectService: "resonance-nexus" },
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
  const base = { name: target.name, url: target.url };
  if (!observation || typeof observation !== "object") return { ...base, outcome: "unknown", ok: false, reason: "no_observation" };
  if (observation.error === "timeout") return { ...base, outcome: "timeout", ok: false };
  if (observation.error) return { ...base, outcome: "unreachable", ok: false };
  const { status, headers = {}, body = "" } = observation;
  const vercelError = String(headers["x-vercel-error"] ?? "");
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
    const missing = Array.isArray(json.missingRequired) ? json.missingRequired.filter((m) => typeof m === "string" && ENV_NAME.test(m)) : [];
    return { ...base, outcome: "not_ready", ok: false, status, missing };
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
    return { status: res.status, headers: { "x-vercel-error": res.headers.get("x-vercel-error") ?? "" }, body };
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
  else for (const r of results) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.name.padEnd(22)} ${r.outcome}${r.missing?.length ? ` missing=[${r.missing.join(",")}]` : ""}${r.status ? ` (${r.status})` : ""}`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}
