#!/usr/bin/env node
/**
 * Entropy Scorer — report-only PR close-candidate prioritizer for portfolio hygiene.
 *
 * Scores open PRs on QuicksilverV1, Resonance, Conduit by:
 * - Age (older = higher close priority for low-value)
 * - Docs-only (title or files suggest docs)
 * - Jules origin (micro-opt noise)
 * - Draft status
 *
 * Outputs ranked list of close candidates. Requires GITHUB_TOKEN for full details (public search works for counts).
 * Never deletes or merges. Pure report.
 *
 * Usage: node scripts/entropy-scorer.mjs [--json] [--markdown]
 */

const REPOS = ["QuicksilverV1", "Resonance", "Conduit"];
const OWNER = "cknowlesbadluck";

async function fetchOpenPRs(repo, token) {
  const headers = { "User-Agent": "entropy-scorer", Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `https://api.github.com/search/issues?q=repo:${OWNER}/${repo}+is:pr+is:open&per_page=100&sort=updated`;
  const res = await fetch(url, { headers });
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

function scorePR(pr, now = Date.now()) {
  let score = 0;
  const ageDays = (now - new Date(pr.created_at).getTime()) / 86400000;
  score += Math.min(ageDays / 7, 5); // age up to 5
  if (pr.draft) score += 2;
  const title = (pr.title || "").toLowerCase();
  if (title.includes("docs") || title.includes("audit") || title.includes("roadmap")) score += 3;
  if (title.includes("jules") || title.includes("bolt") || title.includes("⚡")) score += 4;
  if (title.includes("dependabot") || title.includes("chore(deps)")) score += 2;
  // Lower score = better to keep; higher = closer candidate
  return { number: pr.number, title: pr.title, score: Math.round(score * 10) / 10, ageDays: Math.floor(ageDays), url: pr.html_url, draft: pr.draft };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const all = [];
  for (const repo of REPOS) {
    const prs = await fetchOpenPRs(repo, token);
    for (const pr of prs) {
      all.push({ repo, ...scorePR(pr) });
    }
  }
  all.sort((a, b) => b.score - a.score);
  const closeCandidates = all.filter(p => p.score >= 5);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ at: new Date().toISOString(), total: all.length, closeCandidates: closeCandidates.length, ranked: all }, null, 2));
  } else if (process.argv.includes("--markdown")) {
    console.log("# Entropy Scorer — Close Candidates");
    console.log(`Total open PRs: ${all.length}`);
    console.log("\n## High-score close candidates (score >=5)");
    for (const p of closeCandidates.slice(0, 20)) {
      console.log(`- [${p.repo}#${p.number}](${p.url}) score=${p.score} age=${p.ageDays}d ${p.draft ? "[draft]" : ""} — ${p.title}`);
    }
  } else {
    console.log(`Open PRs: ${all.length}. Close candidates (score>=5): ${closeCandidates.length}`);
    console.log("Top 10:");
    for (const p of all.slice(0, 10)) {
      console.log(`  ${p.repo}#${p.number} score=${p.score} age=${p.ageDays}d — ${p.title.slice(0, 60)}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
