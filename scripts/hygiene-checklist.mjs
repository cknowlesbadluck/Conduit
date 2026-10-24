/**
 * Read-only portfolio hygiene checklist (portfolio-probe --hygiene-checklist).
 * GET-only GitHub REST calls. Token (GH_TOKEN) is optional, sent only as an auth header, never printed.
 * Every fetcher returns null on any error (fail-closed; rendered as "unavailable").
 */
export const OPEN_PR_TARGET = 10;
const DOC_PATH = /(^docs\/|\.md$)/i;

/** Pure: true when every changed file is documentation (docs/** or *.md). Empty/invalid -> false. */
export function isDocsOnly(files) {
  return Array.isArray(files) && files.length > 0 && files.every((f) => typeof f === "string" && DOC_PATH.test(f));
}

/** Pure: newest run per workflow on main -> { status: "green"|"red"|"pending"|"unknown", failing: [names] }. */
export function mainCiStatus(runs, { ignore = [] } = {}) {
  if (!Array.isArray(runs)) return null;
  const latest = new Map();
  for (const r of runs) {
    if (!r || typeof r.name !== "string" || ignore.includes(r.name)) continue;
    const prev = latest.get(r.name);
    if (!prev || Date.parse(r.created_at) > Date.parse(prev.created_at)) latest.set(r.name, r);
  }
  if (latest.size === 0) return { status: "unknown", failing: [] };
  const vals = [...latest.values()];
  const failing = vals.filter((r) => r.status === "completed" && !["success", "skipped", "neutral"].includes(r.conclusion)).map((r) => r.name).sort();
  const pending = vals.some((r) => r.status !== "completed");
  return { status: failing.length ? "red" : pending ? "pending" : "green", failing };
}

const box = (ok) => (ok === true ? "[x]" : ok === false ? "[ ]" : "[?]");
const num = (v) => (Number.isInteger(v) && v >= 0 ? String(v) : "unavailable");
const safe = (s) => String(s).replace(/[^A-Za-z0-9 ._:/-]/g, "");

/** Pure markdown checklist. data: { [repo]: { openPrs, staleBranches, safeDelete, docsOnlyPrs, dependabot, ci } }. */
export function hygieneChecklist(data, { target = OPEN_PR_TARGET, at = new Date().toISOString() } = {}) {
  const out = [`# Hygiene checklist (${safe(at)})`, ""];
  for (const [repo, d0] of Object.entries(data ?? {})) {
    const d = d0 ?? {};
    out.push(`## ${safe(repo)}`);
    const o = Number.isInteger(d.openPrs) ? d.openPrs : null;
    out.push(`- ${box(o === null ? null : o < target)} Open PRs below ${target}: ${num(o)}`);
    out.push(`- ${box(d.ci ? d.ci.status === "green" : null)} Main CI green: ${d.ci ? safe(d.ci.status) + (d.ci.failing.length ? ` (failing: ${d.ci.failing.map(safe).join(", ")})` : "") : "unavailable"}`);
    out.push(`- ${box(Number.isInteger(d.docsOnlyPrs) ? d.docsOnlyPrs <= 1 : null)} Docs-only PRs at most 1 (single living docs PR): ${num(d.docsOnlyPrs)}`);
    out.push(`- ${box(Number.isInteger(d.staleBranches) ? d.staleBranches === 0 : null)} No stale branches: ${num(d.staleBranches)} stale, ${num(d.safeDelete)} safe-delete`);
    out.push(`- ${box(Number.isInteger(d.dependabot) ? d.dependabot === 0 : null)} No open Dependabot alerts: ${num(d.dependabot)}`);
    out.push("");
  }
  return out.join("\n").trimEnd();
}

async function getJson(url, { token, fetchImpl, timeoutMs }) {
  const headers = { "User-Agent": "portfolio-probe", accept: "application/vnd.github+json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

/** Gather checklist inputs. Docs-only and Dependabot need a token (null without one). */
export async function fetchHygiene({ owner = "cknowlesbadluck", repos = ["QuicksilverV1", "Conduit", "Resonance"], token = process.env.GH_TOKEN, fetchImpl = fetch, timeoutMs = 15_000, stale = undefined, ignoreWorkflows = { Conduit: ["Workers Builds: conduit"] } } = {}) {
  const out = {};
  const api = `https://api.github.com/repos/${owner}`;
  for (const repo of repos) {
    const o = { token, fetchImpl, timeoutMs };
    const d = { openPrs: null, docsOnlyPrs: null, ci: null, dependabot: null, staleBranches: null, safeDelete: null };
    let prs = null;
    try { const j = await getJson(`${api}/${repo}/pulls?state=open&per_page=100`, o); if (Array.isArray(j) && j.length < 100) { prs = j; d.openPrs = j.length; } } catch {}
    try { const j = await getJson(`${api}/${repo}/actions/runs?branch=main&per_page=30`, o); d.ci = mainCiStatus(j?.workflow_runs, { ignore: ignoreWorkflows[repo] ?? [] }); } catch {}
    if (token && prs) {
      try {
        let n = 0;
        for (const pr of prs) {
          const files = await getJson(`${api}/${repo}/pulls/${pr.number}/files?per_page=100`, o);
          if (Array.isArray(files) && files.length < 100 && isDocsOnly(files.map((f) => f?.filename))) n++;
        }
        d.docsOnlyPrs = n;
      } catch { d.docsOnlyPrs = null; }
      try { const j = await getJson(`${api}/${repo}/dependabot/alerts?state=open&per_page=100`, o); d.dependabot = Array.isArray(j) && j.length < 100 ? j.length : null; } catch {}
    }
    const s = stale?.[repo];
    if (Array.isArray(s)) { d.staleBranches = s.length; d.safeDelete = s.filter((b) => b?.safeDelete === true).length; }
    out[repo] = d;
  }
  return out;
}
