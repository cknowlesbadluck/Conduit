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
 * Shape (cross-plane contract): a target may name a `schema` in schemas/ready/. When the body
 * is a JSON service payload (ready / not_ready), it must validate; a violation becomes outcome
 * `shape_changed`, ok=false, drift=true. See scripts/ready-shape.mjs.
 *
 * Deploy parity (report-only annotation): a target may pin `parity` = the /ready field set and
 * contractRevision its repo's main declares (for Resonance: `Readiness` in src/deploy/health.ts,
 * mirrored by Resonance scripts/deploy-parity.mjs). When the service answered with JSON, the
 * result gains `behindMain` + `missingContractFields`. It never changes ok/drift/exit code.
 *
 * Usage: node scripts/portfolio-probe.mjs [--json] [--drift-only] [--entropy [--markdown]] [--decisions] [--stale-branches] [--consistency]
 *   --stale-branches: read-only list of branches with no open PR and no commit in 14+ days (scripts/stale-branches.mjs); requires GH_TOKEN; never deletes.
 *   --decisions: read-only owner decision queue (scripts/decision-queue.mjs); requires GH_TOKEN (never printed); repos are null without it.
 *   default: exit 1 if any target is not ok; --drift-only: exit 1 only if any pinned target drifted.
 */

import { checkShape } from "./ready-shape.mjs";

/** Resonance main's /api/ready contract (src/deploy/health.ts `Readiness`, deployLag.ts revision). */
export const RESONANCE_MAIN_READY = Object.freeze({
  contractRevision: "2026-10-03-owner-gate",
  fields: Object.freeze(["status", "service", "stage", "production", "authMode", "authModeOk", "persistenceConfigured", "githubAdapterConfigured", "missingRequired", "ownerActionRequired", "contractRevision", "ownerKeys", "agentActionRequired", "posture", "timestamp"]),
});

export const TARGETS = [
  { name: "conduit", url: "https://conduit-feco.onrender.com/ready", expectService: "conduit", schema: "conduit-ready", expect: { contractRevision: "2026-10-03-ready-surface" } },
  // Owner gate: the service role key is the ONLY thing Resonance prod may be missing.
  { name: "resonance-netlify", url: "https://resonancenexus.netlify.app/api/ready", expectService: "resonance-nexus", schema: "resonance-ready", expect: { missingRequired: [], authMode: "required" }, parity: RESONANCE_MAIN_READY },
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
    // Key-present state: a pinned authMode must match exactly (absent/other = fail closed),
    // and a "ready" body that still lists missing keys is incoherent, not healthy.
    if (expect.authMode !== undefined && r.authMode !== expect.authMode) {
      return { ...r, outcome: "regression", ok: false, drift: true, reason: "auth_mode_changed", expectedAuthMode: expect.authMode };
    }
    if (Array.isArray(expect.missingRequired) && expect.missingRequired.length === 0 && r.readyMissingCount > 0) {
      return { ...r, outcome: "regression", ok: false, drift: true, reason: "ready_with_missing_required" };
    }
    if (expect.missingRequired?.length) return { ...r, drift: true, reason: "owner_gate_cleared_update_pin" };
    return { ...r, drift: false };
  }
  if (r.outcome === "not_ready" && Array.isArray(expect.missingRequired)) {
    // Empty pin = key-present state: any not_ready (even with missingRequired []) is a regression.
    if (expect.missingRequired.length === 0) {
      return { ...r, outcome: "regression", drift: true, expectedMissing: [], reason: "not_ready_with_empty_pin" };
    }
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
    if (json.status === "ready") return { ...base, outcome: "ready", ok: true, status, service, ...(json.version ? { version: String(json.version) } : {}), ...(json.contractRevision ? { contractRevision: String(json.contractRevision) } : {}), ...(typeof json.authMode === "string" ? { authMode: json.authMode } : {}), ...(Array.isArray(json.missingRequired) ? { readyMissingCount: json.missingRequired.length } : {}) };
    return { ...base, outcome: "unknown", ok: false, status, reason: "200_without_ready" };
  }
  if (status === 503 && service === target.expectService && json.status === "not_ready") {
    // Only env-var *names* the server itself chose to publish; values are never seen.
    const raw = json.missingRequired;
    const missing = Array.isArray(raw) ? raw.filter((m) => typeof m === "string" && ENV_NAME.test(m)) : [];
    const missingClean = Array.isArray(raw) && missing.length === raw.length;
    return { ...base, outcome: "not_ready", ok: false, status, service, missing, missingClean };
  }
  if (status === 503 && body.trim() === "" && /cloudflare/i.test(String(headers.server ?? ""))) {
    return { ...base, outcome: "unknown", ok: false, status, reason: "edge_503_empty_origin_unavailable" };
  }
  if (status === 503 && service !== target.expectService && service !== undefined) return { ...base, outcome: "stranger_occupant", ok: false, status, reason: "service_mismatch" };
  return { ...base, outcome: "unknown", ok: false, status };
}

/** Jittered backoff for the single cold-start retry: base * [1, 1.5). Bounded; no polling loop. */
export function retryDelayMs(baseMs, random = Math.random) {
  const r = Number(random());
  const j = Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999) : 0;
  return Math.round(baseMs * (1 + j * 0.5));
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function observe(url, { timeoutMs = 20_000, fetchImpl = fetch, retries = 1, sleep = defaultSleep, random = Math.random } = {}) {
  retries = Math.min(Math.max(0, Math.floor(Number(retries) || 0)), 1); // at most one retry
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // No Authorization/cookies: public endpoints only. redirect: "manual" so a hijacked
      // alias cannot bounce us somewhere else and look healthy.
      const res = await fetchImpl(url, { signal: controller.signal, redirect: "manual", headers: { accept: "application/json" } });
      const body = (await res.text()).slice(0, 16_384);
      const observation = { status: res.status, headers: { "x-vercel-error": res.headers.get("x-vercel-error") ?? "", "cf-mitigated": res.headers.get("cf-mitigated") ?? "", server: res.headers.get("server") ?? "" }, body };
      // Retry once on free-tier cold-start 503s that aren't the known owner-gate not_ready
      if (attempt < retries && res.status === 503) {
        let json;
        try { json = JSON.parse(body); } catch { json = null; }
        if (!(json && json.status === "not_ready" && Array.isArray(json.missingRequired))) {
          await sleep(retryDelayMs(2000, random));
          continue;
        }
      }
      return observation;
    } catch (error) {
      if (attempt < retries && (controller.signal.aborted || error?.name === "AbortError")) {
        await sleep(retryDelayMs(1000, random));
        continue;
      }
      return { error: controller.signal.aborted || error?.name === "AbortError" ? "timeout" : "unreachable" };
    } finally { clearTimeout(timer); }
  }
  return { error: "unreachable" };
}

/** Add the schema verdict for targets that pin one, only when the service actually answered. */
export function attachShape(target, observation, result) {
  if (!target.schema || !["ready", "not_ready", "contract_changed", "regression"].includes(result.outcome)) return result;
  const { ok, errors } = checkShape(target.schema, observation?.body ?? "");
  if (ok) return { ...result, shapeOk: true };
  return { ...result, outcome: "shape_changed", ok: false, drift: true, shapeOk: false, shapeErrors: errors.slice(0, 10), previousOutcome: result.outcome };
}

/** Report-only: compare the answered body's field names with the pinned main contract. */
export function attachParity(target, observation, result) {
  if (!target.parity || !["ready", "not_ready", "contract_changed", "regression"].includes(result.outcome)) return result;
  let json;
  try { json = JSON.parse(observation?.body ?? ""); } catch { return result; }
  if (!json || typeof json !== "object" || Array.isArray(json)) return result;
  const keys = Object.keys(json);
  const missingContractFields = target.parity.fields.filter((f) => !keys.includes(f));
  const revisionMatches = json.contractRevision === target.parity.contractRevision;
  return { ...result, behindMain: missingContractFields.length > 0 || !revisionMatches, missingContractFields, presentFields: keys };
}

export async function probeAll(targets = TARGETS, options) {
  return Promise.all(targets.map(async (t) => {
    const o = await observe(t.url, options);
    // Alias-drift needs field coverage for Vercel aliases too (report-only; never changes ok/drift).
    const pinned = isResonanceAlias(t) && !t.parity ? { ...t, parity: RESONANCE_MAIN_READY } : t;
    return attachShape(t, o, attachParity(pinned, o, classify(t, o)));
  }));
}

/**
 * Read-only cross-plane consistency: for every ready plane that reports a contractRevision,
 * compare it to the revision this repo expects (target.expect, else target.parity). Planes
 * with no expectation are listed but never fail. Pure; no network.
 */
export function crossPlaneConsistency(results, targets = TARGETS) {
  const planes = [];
  for (const r of results) {
    const answered = r.outcome === "ready" || r.outcome === "contract_changed"
      || (r.outcome === "shape_changed" && (r.previousOutcome === "ready" || r.previousOutcome === "contract_changed"));
    if (!answered) continue;
    const t = targets.find((x) => x.name === r.name) ?? {};
    const expected = t.expect?.contractRevision ?? t.parity?.contractRevision;
    const actual = r.contractRevision;
    planes.push({ name: r.name, version: r.version ?? null, contractRevision: actual ?? null, expected: expected ?? null, match: expected === undefined ? null : actual === expected });
  }
  const mismatched = planes.filter((p) => p.match === false).map((p) => p.name);
  return { consistent: mismatched.length === 0, mismatched, planes };
}

/**
 * Read-only cross-plane alias drift: for every configured Resonance Vercel alias
 * (target name starts with "resonance" and the host ends in .vercel.app), decide whether the
 * alias still serves Resonance. Fail closed: an alias only counts as Resonance when it answered
 * with service "resonance-nexus" AND a body carrying every pinned ready-contract field.
 * Anything else (stranger site, absent alias, timeout, challenge, partial body) is flagged.
 * Pure; reuses observations already fetched by probeAll; no env vars, no writes.
 */
export function isResonanceAlias(target) {
  try { return /^resonance/.test(target.name) && new URL(target.url).hostname.endsWith(".vercel.app"); } catch { return false; }
}

export function aliasDrift(results, targets = TARGETS, contract = RESONANCE_MAIN_READY) {
  const aliases = [];
  for (const t of targets.filter(isResonanceAlias)) {
    const r = results.find((x) => x.name === t.name);
    let verdict = "drift", reason = r ? r.outcome : "not_probed";
    // Identity is separate from readiness: a full-contract not_ready (503, owner-gate key missing)
    // is still Resonance, so not_ready/regression bypass the r.ok guard.
    if (r && (r.outcome === "ready" || r.outcome === "not_ready" || r.outcome === "regression") && r.service !== "resonance-nexus") reason = "service_mismatch";
    else if (r && ((r.ok && r.outcome === "ready") || r.outcome === "not_ready" || r.outcome === "regression")) {
      // Check the main contract itself, never the target's own (possibly weaker) parity pin.
      const missing = Array.isArray(r.presentFields) ? contract.fields.filter((f) => !r.presentFields.includes(f)) : contract.fields;
      if (missing.length === 0) { verdict = "resonance"; reason = "ready_contract_present"; }
      else reason = "ready_contract_incomplete";
    } else if (r && r.outcome === "stranger_occupant") reason = "stranger_occupant";
    aliases.push({ name: t.name, url: t.url, verdict, reason, outcome: r?.outcome ?? null });
  }
  const drifted = aliases.filter((a) => a.verdict !== "resonance").map((a) => a.name);
  return { ok: drifted.length === 0, drifted, aliases };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const results = await probeAll();
  const prCounts = await openPrCounts();
  const prEntropyReport = process.argv.includes("--entropy") ? await openPrEntropy() : undefined;
  const decisions = process.argv.includes("--decisions") ? await (await import("./decision-queue.mjs")).fetchDecisionQueue() : undefined;
  const staleBranches = process.argv.includes("--stale-branches") ? await (await import("./stale-branches.mjs")).fetchStaleBranches() : undefined;
  const score = portfolioScore(results);
  const consistency = process.argv.includes("--consistency") ? crossPlaneConsistency(results) : undefined;
  if (consistency && !process.argv.includes("--json")) console.log("Cross-plane consistency:", JSON.stringify(consistency));
  const aliases = process.argv.includes("--alias-drift") ? aliasDrift(results) : undefined;
  if (aliases && !process.argv.includes("--json")) console.log("Resonance alias drift:", JSON.stringify(aliases));
  if (prEntropyReport && process.argv.includes("--markdown")) console.log(entropyMarkdown(prEntropyReport));
  else if (process.argv.includes("--json")) console.log(JSON.stringify({ at: new Date().toISOString(), score, prCounts, prEntropy: prEntropyReport, consistency, aliasDrift: aliases, decisions, staleBranches, results }, null, 2));
  else { console.log("Portfolio maturity score:", score, "/10"); results.forEach(r => console.log(r.name, r.outcome, r.ok ? "OK" : "FAIL", r.drift ? "DRIFT" : "")); console.log("Open PR entropy:", JSON.stringify(prCounts)); if (prEntropyReport) console.log("PR age/stack:", JSON.stringify(prEntropyReport)); if (decisions) for (const [repo, q] of Object.entries(decisions)) console.log("Decisions", repo, q ? JSON.stringify(q.byCategory) : "unavailable"); if (staleBranches) for (const [repo, l] of Object.entries(staleBranches)) console.log("Stale branches", repo, l ? JSON.stringify(l.map((b) => `${b.name} (${b.ageDays}d)`)) : "unavailable"); }
  const pass = process.argv.includes("--drift-only") ? results.every((r) => !r.drift || !TARGETS.find((t) => t.name === r.name)?.expect) : results.every((r) => r.ok);
  process.exitCode = pass ? 0 : 1;
}

/**
 * Innovative portfolio maturity score (0-10).
 * ready = 10, known not_ready (owner gate) = 6, other not_ok = 2, weighted average.
 * Pure, fail-closed, no secrets.
 */
export function portfolioScore(results) {
  if (!results?.length) return 0;
  const scores = results.map(r => {
    if (r.ok && r.outcome === "ready") return 10;
    if (r.outcome === "not_ready" && r.reason === "known_owner_gate") return 6;
    if (r.outcome === "alias_absent" || r.outcome === "stranger_occupant") return 1;
    return 2;
  });
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round(avg * 10) / 10;
}

/**
 * Report open PR counts for portfolio repos (public, unauthenticated rate-limited).
 * Innovative hygiene signal: high entropy = operational risk.
 */
export async function openPrCounts({ repos = ["QuicksilverV1", "Resonance", "Conduit"], fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const counts = {};
  for (const repo of repos) {
    try {
      const res = await fetchImpl(`https://api.github.com/search/issues?q=repo:cknowlesbadluck/${repo}+is:pr+is:open`, { headers: { "User-Agent": "portfolio-probe" }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) {
        const data = await res.json();
        counts[repo] = data?.incomplete_results !== true && Number.isInteger(data.total_count) && data.total_count >= 0 ? data.total_count : null;
      } else counts[repo] = null;
    } catch { counts[repo] = null; }
  }
  return counts;
}


/**
 * Pure PR entropy summary: age buckets (by created_at) and stacked-PR depth
 * (a PR whose base branch is another open PR's head branch). Cycles are cut.
 * Input: GitHub REST /pulls items ({ number, created_at, base: { ref }, head: { ref } }).
 */
export function prEntropy(prs, now = Date.now()) {
  const ageBuckets = { lt1d: 0, d1to7: 0, d7to30: 0, gt30d: 0 };
  const byHead = new Map();
  // Key by repository + ref so a fork's `main` never looks like the base of upstream PRs.
  const key = (side) => `${side?.repo?.full_name ?? ""}:${side?.ref}`;
  for (const pr of prs) if (pr?.head?.ref) byHead.set(key(pr.head), pr);
  let maxStackDepth = 0, stacked = 0, oldestDays = null, drafts = 0;
  for (const pr of prs) {
    if (pr?.draft === true) drafts++;
    const age = (now - Date.parse(pr.created_at)) / 86_400_000;
    if (Number.isFinite(age)) {
      ageBuckets[age < 1 ? "lt1d" : age < 7 ? "d1to7" : age < 30 ? "d7to30" : "gt30d"]++;
      oldestDays = Math.max(oldestDays ?? 0, Math.floor(age));
    }
    let depth = 0; const seen = new Set([pr.number]);
    for (let p = byHead.get(key(pr?.base)); p && !seen.has(p.number); p = byHead.get(key(p.base))) { seen.add(p.number); depth++; }
    if (depth > 0) stacked++;
    maxStackDepth = Math.max(maxStackDepth, depth);
  }
  return { open: prs.length, ageBuckets, oldestDays, stacked, maxStackDepth, drafts };
}

/** Public, unauthenticated, report-only. null per repo on any error (fail-closed, never throws). */
export async function openPrEntropy({ repos = ["Resonance", "Conduit"], fetchImpl = fetch, timeoutMs = 10_000, now = Date.now() } = {}) {
  const out = {};
  for (const repo of repos) {
    try {
      const res = await fetchImpl(`https://api.github.com/repos/cknowlesbadluck/${repo}/pulls?state=open&per_page=100`, { headers: { "User-Agent": "portfolio-probe" }, signal: AbortSignal.timeout(timeoutMs) });
      const data = res.ok ? await res.json() : null;
      out[repo] = Array.isArray(data) && data.length < 100 ? prEntropy(data, now) : null;
    } catch { out[repo] = null; }
  }
  return out;
}

/**
 * Pure markdown table for an openPrEntropy() report (--entropy --markdown).
 * null repos render as "unavailable" (fail-closed); cell values are numbers only.
 */
export function entropyMarkdown(report) {
  const n = (v) => (Number.isFinite(v) ? String(v) : "-");
  const rows = ["| Repo | Open | <1d | 1-7d | 7-30d | >30d | Oldest (d) | Stacked | Max depth | Drafts |", "|---|---|---|---|---|---|---|---|---|---|"];
  for (const [repo, e] of Object.entries(report ?? {})) {
    const name = String(repo).replace(/[^A-Za-z0-9._-]/g, "");
    if (!e) { rows.push(`| ${name} | unavailable | | | | | | | | |`); continue; }
    const b = e.ageBuckets ?? {};
    rows.push(`| ${name} | ${n(e.open)} | ${n(b.lt1d)} | ${n(b.d1to7)} | ${n(b.d7to30)} | ${n(b.gt30d)} | ${n(e.oldestDays)} | ${n(e.stacked)} | ${n(e.maxStackDepth)} | ${n(e.drafts)} |`);
  }
  return rows.join("\n");
}
