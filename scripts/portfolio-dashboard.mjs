#!/usr/bin/env node
// Read-only cross-plane portfolio dashboard: live ready status of the owned planes (Conduit,
// Resonance on Netlify), the Vercel alias owner check, and per-repo open-PR counts with hygiene
// close candidates. It composes scripts/portfolio-probe.mjs and scripts/pr-hygiene.mjs (no duplicate
// probe or PR logic). Fail-closed: any probe or GitHub API error makes the verdict NOT READY / unknown and
// the exit code nonzero. Never writes, closes, merges, or prints credentials.
//
// Usage: node scripts/portfolio-dashboard.mjs [--json] [--repos QuicksilverV1,Conduit,Resonance]
//          [--consistency [--roadmap-ref main]]   (adds scripts/portfolio-consistency.mjs; an inconsistency fails the run)
// Auth:  the local `gh` session or GH_TOKEN, used only by `gh` itself.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TARGETS, observe, classify } from "./portfolio-probe.mjs";
import { summarizeRepo, fetchOpenPrs, loadOwnerOnly } from "./pr-hygiene.mjs";
import { checkConsistency, consistencyMarkdown } from "./portfolio-consistency.mjs";
import { execFileSync } from "node:child_process";

/** Planes the portfolio owns: these must be ready. Everything else is an alias owner check (informational). */
const OWNED = new Set(["conduit", "resonance-netlify"]);
/** Render free-tier cold start: extra attempts after these waits (seconds) while Conduit is not ready. */
export const COLD_START_DELAYS_S = Object.freeze([10, 20, 30, 45]);

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** Probe one target; for `coldStart` targets retry on the fixed schedule until ready. Errors -> classified non-ready. */
export async function probeTarget(target, { observeImpl = observe, sleep = sleepMs, coldStart = false, delays = COLD_START_DELAYS_S } = {}) {
  let r = classify(target, await observeImpl(target.url).catch(() => ({ error: "unreachable" })));
  let attempts = 1;
  for (const s of coldStart ? delays : []) {
    if (r.ok) break;
    await sleep(s * 1000);
    r = classify(target, await observeImpl(target.url).catch(() => ({ error: "unreachable" })));
    attempts++;
  }
  return { ...r, attempts };
}

/** Pure. Combine plane results and repo summaries into a verdict. Missing data is never "ready". */
export function buildDashboard({ planes, repos }) {
  const owned = (planes ?? []).filter((p) => OWNED.has(p?.name));
  const aliases = (planes ?? []).filter((p) => !OWNED.has(p?.name));
  const missingOwned = [...OWNED].filter((n) => !owned.some((p) => p.name === n));
  const repoRows = Object.entries(repos ?? {}).map(([repo, s]) => ({
    repo, open: s ? s.open : null, overTarget: s ? s.overTarget : null, ownerOnly: s ? (s.ownerOnly ?? null) : null,
    closeCandidates: s ? s.closeCandidates.map((c) => c.number) : null,
  }));
  const problems = [
    ...missingOwned.map((n) => `plane_missing:${n}`),
    ...owned.filter((p) => !p.ok).map((p) => `plane_not_ready:${p.name}:${p.outcome}`),
    ...repoRows.filter((r) => r.open === null).map((r) => `repo_unavailable:${r.repo}`),
  ];
  if (repoRows.length === 0) problems.push("no_repos");
  return {
    ready: problems.length === 0, problems,
    planes: owned.map((p) => ({ name: p.name, outcome: p.outcome, ok: Boolean(p.ok), attempts: p.attempts ?? 1 })),
    aliasOwnerCheck: aliases.map((p) => ({ name: p.name, outcome: p.outcome, ours: Boolean(p.ok) })),
    repos: repoRows,
  };
}

export function dashboardMarkdown(d) {
  const cell = (v) => (v === null || v === undefined ? "unknown" : String(v));
  const out = [`**Portfolio: ${d.ready ? "READY" : "NOT READY"}**${d.problems.length ? ` (${d.problems.join(", ")})` : ""}`, "",
    "| Plane | Outcome | OK | Attempts |", "|---|---|---|---|",
    ...d.planes.map((p) => `| ${p.name} | ${p.outcome} | ${p.ok ? "yes" : "NO"} | ${p.attempts} |`), "",
    "| Vercel alias | Outcome | Ours? |", "|---|---|---|",
    ...d.aliasOwnerCheck.map((a) => `| ${a.name} | ${a.outcome} | ${a.ours ? "yes" : "no"} |`), "",
    "| Repo | Open PRs | Over target | Owner-only | Close candidates |", "|---|---|---|---|---|",
    ...d.repos.map((r) => `| ${r.repo} | ${cell(r.open)} | ${cell(r.overTarget)} | ${cell(r.ownerOnly)} | ${r.closeCandidates === null ? "unknown" : r.closeCandidates.map((n) => `#${n}`).join(" ") || "-"} |`)];
  return out.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const i = process.argv.indexOf("--repos");
  const names = (i > 0 ? process.argv[i + 1] ?? "" : "QuicksilverV1,Conduit,Resonance").split(",").filter((r) => /^[A-Za-z0-9._-]+$/.test(r));
  let d;
  try {
    const planes = await Promise.all(TARGETS.map((t) => probeTarget(t, { coldStart: t.name === "conduit" })));
    const isOwnerOnly = await loadOwnerOnly();
    const repos = Object.fromEntries(names.map((r) => [r, summarizeRepo(fetchOpenPrs(r), { isOwnerOnly })]));
    d = buildDashboard({ planes, repos });
    if (process.argv.includes("--consistency")) {
      const j = process.argv.indexOf("--roadmap-ref");
      const ref = j > 0 && /^[A-Za-z0-9._\/-]+$/.test(process.argv[j + 1] ?? "") ? process.argv[j + 1] : "main";
      const body = async (u) => { try { const res = await fetch(u, { signal: AbortSignal.timeout(20_000) }); return res.ok ? await res.json() : null; } catch { return null; } };
      let unauthPostStatus = null; // unauthenticated, empty body: must be rejected; nothing is created
      try { unauthPostStatus = (await fetch("https://resonancenexus.netlify.app/api/nexus/executions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(20_000) })).status; } catch {}
      let roadmap = null;
      try { roadmap = execFileSync("gh", ["api", "-H", "Accept: application/vnd.github.raw", `repos/cknowlesbadluck/Resonance/contents/docs/PORTFOLIO-ROADMAP-10-PHASE.md?ref=${ref}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch {}
      const k = checkConsistency({ roadmap, live: {
        conduit: await body(TARGETS.find((t) => t.name === "conduit").url),
        resonance: await body(TARGETS.find((t) => t.name === "resonance-netlify").url),
        unauthPostStatus, openPrs: Object.fromEntries(d.repos.map((r) => [r.repo, r.open])) } });
      d = { ...d, ready: d.ready && k.consistent, problems: [...d.problems, ...k.problems], consistency: { ref, ...k } };
    }
  } catch (e) {
    d = { ready: false, problems: [`dashboard_error:${String(e?.message ?? e).slice(0, 120)}`], planes: [], aliasOwnerCheck: [], repos: [] };
  }
  console.log(process.argv.includes("--json") ? JSON.stringify({ at: new Date().toISOString(), ...d }, null, 2)
    : dashboardMarkdown(d) + (d.consistency ? `\n\n_Roadmap ref: ${d.consistency.ref}_\n` + consistencyMarkdown(d.consistency) : ""));
  process.exitCode = d.ready ? 0 : 1;
}
