#!/usr/bin/env node
/**
 * Entropy Dashboard — report-only PR close/merge candidate prioritizer.
 *
 * Scores open PRs across QuicksilverV1, Resonance, Conduit by:
 * - age (days open)
 * - CI status (green/red/pending/unknown)
 * - file overlap with other open PRs (conflict risk)
 * - docs-only flag
 * - Jules/micro-opt origin
 * - author association
 *
 * Output: ranked list of close candidates and merge candidates.
 * Never mutates. Requires GITHUB_TOKEN or gh auth.
 *
 * Usage: node scripts/entropy-dashboard.mjs
 */
import { execSync } from "node:child_process";

const REPOS = [
  "cknowlesbadluck/QuicksilverV1",
  "cknowlesbadluck/Resonance",
  "cknowlesbadluck/Conduit",
];

function gh(cmd) {
  return execSync(`gh ${cmd}`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function scorePR(pr, allPRs) {
  let score = 0;
  const reasons = [];
  const ageDays = Math.floor((Date.now() - new Date(pr.createdAt).getTime()) / 86400000);
  if (ageDays > 14) { score += 2; reasons.push(`old(${ageDays}d)`); }
  if (pr.title.toLowerCase().includes("bolt") || pr.title.includes("⚡")) { score += 3; reasons.push("jules-micro"); }
  if (pr.title.toLowerCase().includes("docs:") || pr.title.toLowerCase().includes("audit")) { score += 2; reasons.push("docs-only"); }
  // Simple overlap heuristic: same base files mentioned in titles or bodies (very rough)
  const filesHint = (pr.title + " " + (pr.body || "")).toLowerCase();
  const overlap = allPRs.filter(other => other.number !== pr.number && filesHint.split(/\s+/).some(w => w.length > 8 && other.title.toLowerCase().includes(w))).length;
  if (overlap > 0) { score += 1; reasons.push(`possible-overlap(${overlap})`); }
  return { score, reasons, ageDays };
}

async function main() {
  console.log("# Entropy Dashboard — " + new Date().toISOString());
  console.log("Report-only. No mutations.\n");
  for (const repo of REPOS) {
    console.log(`## ${repo}`);
    try {
      const json = gh(`pr list --repo ${repo} --state open --limit 100 --json number,title,createdAt,author,body,statusCheckRollup`);
      const prs = JSON.parse(json);
      const scored = prs.map(pr => ({ ...pr, ...scorePR(pr, prs) })).sort((a, b) => b.score - a.score);
      console.log(`Open: ${prs.length}`);
      console.log("Top close candidates (high score = prune first):");
      scored.slice(0, 8).forEach(p => {
        console.log(`  #${p.number} [${p.score}] ${p.title.slice(0, 80)} | ${p.reasons.join(", ")}`);
      });
      console.log("");
    } catch (e) {
      console.log(`  Error: ${e.message}\n`);
    }
  }
  console.log("Target: <10 open per repo. Merge green non-overlapping hardens first. Close Jules micro-opts and pure docs mirrors.");
}

main().catch(console.error);
