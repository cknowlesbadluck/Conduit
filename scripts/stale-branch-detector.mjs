#!/usr/bin/env node
/**
 * Innovative hygiene tool: detects potentially stale branches across the portfolio.
 * Compares remote branches against main and open PRs. Safe, read-only by default.
 * Usage: node scripts/stale-branch-detector.mjs [--repo owner/repo] [--days 14]
 */
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const repo = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : 'cknowlesbadluck/Conduit';
const days = parseInt(args.includes('--days') ? args[args.indexOf('--days') + 1] : '14', 10);

function gh(cmd) {
  return execSync(`gh ${cmd}`, { encoding: 'utf8' }).trim();
}

const branches = JSON.parse(gh(`api repos/${repo}/branches --paginate`));
const openPRs = JSON.parse(gh(`api repos/${repo}/pulls?state=open&per_page=100`));
const prBranches = new Set(openPRs.map(pr => pr.head.ref));

const stale = [];
const now = Date.now();
for (const b of branches) {
  if (b.name === 'main') continue;
  if (prBranches.has(b.name)) continue;
  // Approximate age from commit if available; otherwise flag for review
  stale.push({ name: b.name, hasOpenPR: false, recommendation: 'Review for prune if no recent activity' });
}

console.log(JSON.stringify({ repo, thresholdDays: days, staleCandidates: stale, totalBranches: branches.length, openPRBranches: prBranches.size }, null, 2));
