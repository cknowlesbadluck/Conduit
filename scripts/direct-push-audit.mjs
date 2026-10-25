#!/usr/bin/env node
// Read-only: lists commits on a repo's default branch since a time that have no associated
// pull request (direct pushes), and classifies them docs-only vs code. Feeds roadmap phase 4
// (main protection). Uses only GET via `gh api`; never writes.
// Usage: node scripts/direct-push-audit.mjs --since 2026-10-25T14:05:00Z [--repos A,B] [--owner o] [--json]
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const isDocsPath = (p) => /\.md$/i.test(p) || /^docs\//.test(p);

/** Pure. commits: [{ sha, date, message, author, prs:[n], files:[path] }] -> findings (no-PR commits only). */
export function directPushes(commits) {
  return (commits ?? []).filter((c) => Array.isArray(c?.prs) && c.prs.length === 0).map((c) => {
    const files = Array.isArray(c.files) ? c.files : null;
    const kind = !files || files.length === 0 ? "unknown" : files.every(isDocsPath) ? "docs" : "code";
    return { sha: String(c.sha).slice(0, 7), date: c.date, author: c.author, kind, subject: String(c.message ?? "").split("\n")[0].slice(0, 100) };
  });
}

/** Pure. report: { repo: findings[] | null } -> markdown. Code direct pushes are flagged loudly. */
export function directPushMarkdown(report, since) {
  const L = [`Direct pushes to main since ${since} (commits with no associated PR):`, "", "| Repo | Direct pushes | Docs | Code | Unknown | Commits |", "|---|---|---|---|---|---|"];
  for (const [repo, f] of Object.entries(report)) {
    const name = String(repo).replace(/[^A-Za-z0-9._-]/g, "");
    if (!f) { L.push(`| ${name} | unavailable | | | | |`); continue; }
    const n = (k) => f.filter((x) => x.kind === k).length;
    L.push(`| ${name} | ${f.length} | ${n("docs")} | ${n("code") ? `**${n("code")}**` : 0} | ${n("unknown")} | ${f.map((x) => `${x.sha}${x.kind === "code" ? "!" : ""}`).join(" ") || "-"} |`);
  }
  return L.join("\n");
}

function ghJson(args) { return JSON.parse(execFileSync("gh", args, { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] })); }

export function fetchCommits(repo, since, run = ghJson) {
  try {
    const list = run(["api", `repos/${repo}/commits?sha=main&since=${encodeURIComponent(since)}&per_page=100`]);
    if (!Array.isArray(list)) return null;
    if (list.length >= 100) throw new Error("more than 100 commits; narrow --since");
    return list.map((c) => {
      const prs = run(["api", `repos/${repo}/commits/${c.sha}/pulls`]);
      const detail = run(["api", `repos/${repo}/commits/${c.sha}`]);
      const files = Array.isArray(detail?.files) && detail.files.length < 300 ? detail.files.map((f) => f.filename) : null; // API caps at 300 files
      return { sha: c.sha, date: c.commit?.author?.date, author: c.commit?.author?.name, message: c.commit?.message, prs: Array.isArray(prs) ? prs.map((p) => p.number) : null, files };
    });
  } catch { return null; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const since = arg("--since");
  if (!since || Number.isNaN(Date.parse(since))) { console.error("--since <ISO time> is required"); process.exit(2); }
  const owner = arg("--owner", "cknowlesbadluck");
  const repos = arg("--repos", "QuicksilverV1,Conduit,Resonance").split(",").filter((r) => /^[A-Za-z0-9._-]+$/.test(r));
  const report = {};
  for (const r of repos) { const c = fetchCommits(`${owner}/${r}`, since); report[r] = c && !c.some((x) => x.prs === null) ? directPushes(c) : null; }
  if (process.argv.includes("--json")) console.log(JSON.stringify({ since, report }, null, 2));
  else console.log(directPushMarkdown(report, since));
  process.exitCode = Object.values(report).some((f) => f?.some((x) => x.kind === "code")) ? 1 : 0;
}
