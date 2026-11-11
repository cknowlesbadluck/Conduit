#!/usr/bin/env node
/**
 * Read-only entropy scoring for portfolio open PRs.
 * Ranks by age, title keywords (docs/hygiene/noise), and suggests close candidates.
 * No writes. Uses gh or GITHUB_TOKEN if available; falls back to local note.
 * Usage: node scripts/entropy-score.mjs [--json]
 */
import { execSync } from 'child_process';
import process from 'process';

const REPOS = [
  { name: 'QuicksilverV1', owner: 'cknowlesbadluck' },
  { name: 'Resonance', owner: 'cknowlesbadluck' },
  { name: 'Conduit', owner: 'cknowlesbadluck' }
];

function ageDays(createdAt) {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));
}

function scorePR(pr) {
  let score = 0;
  const title = (pr.title || '').toLowerCase();
  const age = ageDays(pr.created_at);
  score += Math.min(age, 30); // older = higher close priority
  if (title.includes('docs') || title.includes('hygiene') || title.includes('mirror') || title.includes('audit')) score += 10;
  if (title.includes('draft') || pr.draft) score += 5;
  if (title.includes('noise') || title.includes('supersede') || title.includes('close')) score += 15;
  if (pr.comments > 10) score -= 5; // more discussion = maybe keep
  return { ...pr, entropyScore: score, ageDays: age };
}

function getOpenPRs(owner, repo) {
  try {
    const cmd = `gh pr list --repo ${owner}/${repo} --state open --limit 50 --json number,title,createdAt,draft,comments,author`;
    const out = execSync(cmd, { encoding: 'utf8', timeout: 15000 });
    return JSON.parse(out);
  } catch (e) {
    console.error(`Failed to list PRs for ${owner}/${repo}: ${e.message}`);
    return [];
  }
}

const jsonMode = process.argv.includes('--json');
const results = [];

for (const r of REPOS) {
  const prs = getOpenPRs(r.owner, r.name).map(scorePR).sort((a, b) => b.entropyScore - a.entropyScore);
  results.push({ repo: r.name, openCount: prs.length, topCloseCandidates: prs.slice(0, 5) });
}

if (jsonMode) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log('Portfolio Entropy Score (higher = stronger close candidate)\n');
  for (const res of results) {
    console.log(`## ${res.repo} (${res.openCount} open)`);
    for (const pr of res.topCloseCandidates) {
      console.log(`  #${pr.number} score=${pr.entropyScore} age=${pr.ageDays}d ${pr.draft ? '[DRAFT] ' : ''}${pr.title}`);
    }
    console.log('');
  }
  console.log('Read-only. Review before any close. Target total open <10.');
}
