#!/usr/bin/env node
// Report-only merge-train health check for the open PR backlog.
//
// Answers, from the GitHub API alone (no writes, no secrets printed):
//   - which open PRs are green + mergeable + not owner-gated (merge candidates, in a safe order)
//   - which PRs add the SAME new file (duplicate implementations, e.g. two src/db-pool.ts)
//   - which PR pairs overlap so heavily they are probably stacked or superseded
//   - which files are conflict hotspots (touched by many open PRs)
//   - which PRs touch auth/grants/bridge paths and therefore need owner review
//
// Usage:  node scripts/merge-train.mjs [owner/repo] [--json]
// Auth:   GITHUB_TOKEN (Actions) or, if unset, the local `gh` CLI session.
import { execFileSync } from "node:child_process";

export const IGNORED_CHECKS = new Set(["Workers Builds: conduit"]); // fails on main too (see ROADMAP)
export const SENSITIVE = [/^src\/auth/, /grant/, /capabilit/, /bridge/, /external-policy/, /receipt/, /^src\/index\.ts$/, /^src\/app-factory/];
const OK = new Set(["success", "neutral", "skipped"]);

export function isSensitive(files) {
  return files.some((f) => SENSITIVE.some((re) => re.test(f.filename)) && !/\.test\.ts$/.test(f.filename));
}

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}

/** Pure analysis over already-fetched PR data (unit-tested). */
export function analyze(prs, { overlapThreshold = 0.8, hotspotMin = 3 } = {}) {
  const added = new Map();
  const touched = new Map();
  for (const pr of prs) {
    for (const f of pr.files) {
      if (f.status === "added") added.set(f.filename, [...(added.get(f.filename) ?? []), pr.number]);
      touched.set(f.filename, [...(touched.get(f.filename) ?? []), pr.number]);
    }
  }
  const duplicateAdds = [...added].filter(([, ns]) => ns.length > 1).map(([file, prs]) => ({ file, prs }));
  const hotspots = [...touched].filter(([f, ns]) => ns.length >= hotspotMin && !/package-lock\.json$/.test(f))
    .map(([file, prs]) => ({ file, prs })).sort((a, b) => b.prs.length - a.prs.length);
  const overlaps = [];
  for (let i = 0; i < prs.length; i++) for (let j = i + 1; j < prs.length; j++) {
    const a = prs[i].files.map((f) => f.filename), b = prs[j].files.map((f) => f.filename);
    if (a.length < 2 || b.length < 2) continue;
    const score = jaccard(a, b);
    if (score >= overlapThreshold) overlaps.push({ prs: [prs[i].number, prs[j].number], score: Math.round(score * 100) / 100 });
  }
  const rows = prs.map((pr) => {
    const failing = pr.checks.filter((c) => c.status === "completed" && !OK.has(c.conclusion) && !IGNORED_CHECKS.has(c.name)).map((c) => c.name);
    const pending = pr.checks.filter((c) => c.status !== "completed" && !IGNORED_CHECKS.has(c.name)).map((c) => c.name);
    const sensitive = isSensitive(pr.files);
    const blocked = pr.draft || /DO NOT MERGE|KEEP RED/i.test(pr.title);
    const ci = failing.length ? "red" : pending.length ? "pending" : pr.checks.length ? "green" : "none";
    const conflicts = hotspots.filter((h) => h.prs.includes(pr.number)).length;
    const candidate = ci === "green" && pr.mergeable === "MERGEABLE" && !sensitive && !blocked;
    return { number: pr.number, title: pr.title, ci, failing, mergeable: pr.mergeable, sensitive, blocked, size: pr.files.length, conflicts, candidate };
  });
  const mergeOrder = rows.filter((r) => r.candidate).sort((a, b) => a.conflicts - b.conflicts || a.size - b.size || a.number - b.number).map((r) => r.number);
  return { rows, duplicateAdds, overlaps, hotspots, mergeOrder };
}

export function toMarkdown(repo, r) {
  const L = [`# Merge-train health: ${repo} (${r.rows.length} open PRs)`, ""];
  L.push(`Merge candidates (green, mergeable, not owner-gated), suggested order: ${r.mergeOrder.map((n) => `#${n}`).join(", ") || "none"}`, "");
  if (r.duplicateAdds.length) { L.push("## Duplicate new files (pick one implementation)"); for (const d of r.duplicateAdds) L.push(`- ${d.file}: ${d.prs.map((n) => `#${n}`).join(", ")}`); L.push(""); }
  if (r.overlaps.length) { L.push("## Heavy overlap (stacked or superseded?)"); for (const o of r.overlaps) L.push(`- #${o.prs[0]} ~ #${o.prs[1]} (jaccard ${o.score})`); L.push(""); }
  if (r.hotspots.length) { L.push("## Conflict hotspots"); for (const h of r.hotspots.slice(0, 10)) L.push(`- ${h.file}: ${h.prs.length} PRs (${h.prs.map((n) => `#${n}`).join(", ")})`); L.push(""); }
  L.push("## PRs", "| PR | CI | mergeable | owner review | blocked | files |", "|---|---|---|---|---|---|");
  for (const x of r.rows) L.push(`| #${x.number} | ${x.ci}${x.failing.length ? ` (${x.failing.join(", ")})` : ""} | ${x.mergeable} | ${x.sensitive ? "yes" : ""} | ${x.blocked ? "yes" : ""} | ${x.size} |`);
  return L.join("\n");
}

async function api(path) {
  if (process.env.GITHUB_TOKEN) {
    const res = await fetch(`https://api.github.com/${path}`, { headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
    return res.json();
  }
  return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 32 << 20, timeout: 30_000 }));
}

// GitHub computes `mergeable` lazily: the first read often returns null. Re-read a few times.
async function pullWithMergeable(repo, number, tries = 3) {
  let detail = await api(`repos/${repo}/pulls/${number}`);
  for (let i = 1; i < tries && detail.mergeable === null; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    detail = await api(`repos/${repo}/pulls/${number}`);
  }
  return detail;
}

async function collect(repo) {
  const list = await api(`repos/${repo}/pulls?state=open&per_page=100`);
  const out = [];
  for (const p of list) {
    const [detail, files, runs] = await Promise.all([
      pullWithMergeable(repo, p.number),
      api(`repos/${repo}/pulls/${p.number}/files?per_page=100`),
      api(`repos/${repo}/commits/${p.head.sha}/check-runs?per_page=100`),
    ]);
    const mergeable = detail.mergeable === true ? "MERGEABLE" : detail.mergeable === false ? "CONFLICTING" : "UNKNOWN";
    out.push({ number: p.number, title: p.title, draft: p.draft, mergeable, files: files.map((f) => ({ filename: f.filename, status: f.status })), checks: runs.check_runs.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion })) });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.argv.slice(2).find((a) => a.includes("/")) ?? process.env.GITHUB_REPOSITORY ?? "cknowlesbadluck/Conduit";
  const result = analyze(await collect(repo));
  console.log(process.argv.includes("--json") ? JSON.stringify(result, null, 2) : toMarkdown(repo, result));
}
