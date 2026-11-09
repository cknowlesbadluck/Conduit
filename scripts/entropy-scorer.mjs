#!/usr/bin/env node
/**
 * Report-only PR entropy scorer for portfolio hygiene.
 * score = (age_days * 0.4) + (is_docs_only ? 3 : 0) + (is_bolt_jules ? 2 : 0) + (has_overlap ? 1 : 0) - (ci_green ? 1 : 0)
 * Higher score = stronger close candidate. Never auto-closes. Fail-closed, no secrets.
 *
 * Usage: node scripts/entropy-scorer.mjs [--json] [--top N]
 * Requires GH_TOKEN or unauthenticated (rate-limited).
 */

const REPOS = ["QuicksilverV1", "Resonance", "Conduit"];
const OWNER = "cknowlesbadluck";

async function fetchOpenPRs(repo, token) {
  const headers = { "User-Agent": "entropy-scorer", Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `https://api.github.com/search/issues?q=repo:${OWNER}/${repo}+is:pr+is:open&per_page=100&sort=updated&order=desc`;
  const res = await fetch(url, { headers });
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

function scorePR(pr, now = Date.now()) {
  const ageDays = Math.max(0, (now - new Date(pr.created_at).getTime()) / 86400000);
  const title = (pr.title || "").toLowerCase();
  const isDocsOnly = title.includes("docs:") || title.includes("docs ") || title.startsWith("docs");
  const isBoltJules = title.includes("bolt") || title.includes("jules") || title.includes("⚡");
  // Overlap and CI green require additional calls; approximate as false for pure report
  const hasOverlap = false;
  const ciGreen = false;
  const score = (ageDays * 0.4) + (isDocsOnly ? 3 : 0) + (isBoltJules ? 2 : 0) + (hasOverlap ? 1 : 0) - (ciGreen ? 1 : 0);
  return { number: pr.number, title: pr.title, ageDays: Math.round(ageDays * 10) / 10, isDocsOnly, isBoltJules, score: Math.round(score * 10) / 10, html_url: pr.html_url };
}

async function main() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const top = process.argv.includes("--top") ? parseInt(process.argv[process.argv.indexOf("--top") + 1] || "5", 10) : 5;
  const all = [];
  for (const repo of REPOS) {
    const prs = await fetchOpenPRs(repo, token);
    for (const pr of prs) {
      const s = scorePR(pr);
      all.push({ repo, ...s });
    }
  }
  all.sort((a, b) => b.score - a.score);
  const topN = all.slice(0, top);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ at: new Date().toISOString(), top: topN, totalOpen: all.length }, null, 2));
  } else {
    console.log(`Entropy top ${top} close candidates (higher = more noise):`);
    topN.forEach((p, i) => console.log(`${i + 1}. ${p.repo}#${p.number} score=${p.score} age=${p.ageDays}d ${p.isDocsOnly ? "[docs]" : ""}${p.isBoltJules ? "[bolt]" : ""} ${p.title}`));
    console.log(`\nTotal open PRs scored: ${all.length}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
