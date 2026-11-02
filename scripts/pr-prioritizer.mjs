#!/usr/bin/env node
/**
 * Report-only PR prioritizer for hygiene prune.
 * Scores open PRs for close/merge candidates.
 * Flags: Jules origin, docs-only, micro-opt keywords, age, stacked.
 * Zero dependencies. No writes. No secrets printed.
 *
 * Usage: node scripts/pr-prioritizer.mjs [owner/repo] [--json]
 * Auth: GITHUB_TOKEN or gh CLI.
 */
import { execFileSync } from "node:child_process";

const JULES_MARKERS = /jules|⚡ Bolt|google-labs-jules/i;
const MICRO_OPT = /localeCompare|direct comparison|single-pass|fast-path|microbenchmark|speedup/i;
const DOCS_ONLY = /docs\/|README|AUDIT-|ROADMAP|hygiene/i;

function scorePR(pr, files = []) {
  let score = 50; // higher = better candidate to keep/merge; lower = close
  const reasons = [];
  const ageDays = (Date.now() - Date.parse(pr.created_at)) / 86_400_000;
  if (ageDays > 30) { score -= 20; reasons.push("age>30d"); }
  else if (ageDays > 7) { score -= 10; reasons.push("age>7d"); }

  const titleBody = `${pr.title}\n${pr.body || ""}`;
  if (JULES_MARKERS.test(titleBody) || pr.user?.login === "google-labs-jules") {
    score -= 25; reasons.push("jules-bolt");
  }
  if (MICRO_OPT.test(titleBody)) {
    score -= 15; reasons.push("micro-opt");
  }
  const isDocs = files.every(f => DOCS_ONLY.test(f.filename) || f.filename.endsWith(".md"));
  if (isDocs && files.length > 0) {
    score -= 20; reasons.push("docs-only");
  }
  if (pr.draft) { score -= 10; reasons.push("draft"); }
  if (/DO NOT MERGE|KEEP RED/i.test(pr.title)) { score -= 30; reasons.push("do-not-merge"); }

  // Prefer small, recent, non-Jules for merge
  if (files.length > 0 && files.length < 5 && !JULES_MARKERS.test(titleBody)) score += 10;

  return { number: pr.number, title: pr.title, score: Math.max(0, Math.min(100, score)), reasons, ageDays: Math.floor(ageDays), files: files.length };
}

async function api(path) {
  if (process.env.GITHUB_TOKEN) {
    const res = await fetch(`https://api.github.com/${path}`, {
      headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    return res.json();
  }
  return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 32 << 20 }));
}

async function main() {
  const repo = process.argv.slice(2).find(a => a.includes("/")) ?? "cknowlesbadluck/Conduit";
  const list = await api(`repos/${repo}/pulls?state=open&per_page=100`);
  const scored = [];
  for (const p of list.slice(0, 50)) { // cap for rate
    let files = [];
    try {
      files = await api(`repos/${repo}/pulls/${p.number}/files?per_page=100`);
    } catch {}
    scored.push(scorePR(p, files));
  }
  scored.sort((a, b) => a.score - b.score); // lowest score = strongest close candidates
  const closeCandidates = scored.filter(s => s.score < 40);
  const keep = scored.filter(s => s.score >= 40);
  const out = { repo, open: list.length, closeCandidates, keep, generated: new Date().toISOString() };
  console.log(process.argv.includes("--json") ? JSON.stringify(out, null, 2) : toMarkdown(out));
}

function toMarkdown(r) {
  const L = [`# PR Prioritizer: ${r.repo} (${r.open} open)`, "", "## Close candidates (lowest score first)", ""];
  for (const c of r.closeCandidates) {
    L.push(`- #${c.number} score=${c.score} age=${c.ageDays}d files=${c.files} reasons=${c.reasons.join(",")} — ${c.title}`);
  }
  L.push("", "## Higher-score (review/merge candidates)", "");
  for (const k of r.keep.slice(0, 15)) {
    L.push(`- #${k.number} score=${k.score} — ${k.title}`);
  }
  return L.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
