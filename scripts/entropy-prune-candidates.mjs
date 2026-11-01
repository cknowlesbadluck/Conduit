#!/usr/bin/env node
/**
 * Cross-portfolio entropy prune candidate report.
 * Read-only. Classifies open PRs in QuicksilverV1, Resonance, Conduit
 * as close-candidate (docs-only, bolt/jules micro-opt, pure audit) or keep.
 * No secrets, no writes.
 *
 * Usage: node scripts/entropy-prune-candidates.mjs [--json]
 */
import { execSync } from 'node:child_process';

const REPOS = ['QuicksilverV1', 'Resonance', 'Conduit'];
const CLOSE_PATTERNS = [
  /docs?:/i,
  /audit/i,
  /mirror/i,
  /bolt:/i,
  /jules/i,
  /hygiene/i,
  /micro-opt/i,
  /fast-path/i,
  /single-pass/i,
];

function classify(title, body = '') {
  const text = (title + ' ' + body).toLowerCase();
  if (CLOSE_PATTERNS.some(p => p.test(text))) return 'close-candidate';
  if (/do not merge without owner approval/i.test(body)) return 'owner-gated';
  return 'keep';
}

function fetchPRs(repo) {
  try {
    const raw = execSync(`gh pr list --repo cknowlesbadluck/${repo} --state open --limit 100 --json number,title,body,createdAt,author`, { encoding: 'utf8' });
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to list PRs for ${repo}:`, e.message);
    return [];
  }
}

const report = { generatedAt: new Date().toISOString(), repos: {} };

for (const repo of REPOS) {
  const prs = fetchPRs(repo);
  const classified = prs.map(pr => ({
    number: pr.number,
    title: pr.title,
    createdAt: pr.createdAt,
    class: classify(pr.title, pr.body || ''),
    url: `https://github.com/cknowlesbadluck/${repo}/pull/${pr.number}`,
  }));
  const byClass = classified.reduce((acc, p) => {
    acc[p.class] = (acc[p.class] || 0) + 1;
    return acc;
  }, {});
  report.repos[repo] = { total: prs.length, byClass, candidates: classified.filter(p => p.class === 'close-candidate') };
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`# Portfolio Entropy Prune Candidates — ${report.generatedAt}`);
  for (const [repo, data] of Object.entries(report.repos)) {
    console.log(`\n## ${repo} (${data.total} open)`);
    console.log(`Close-candidates: ${data.byClass['close-candidate'] || 0}`);
    data.candidates.forEach(c => console.log(`- #${c.number} ${c.title}`));
  }
  console.log('\nRecommendation: close pure docs/audit/bolt micro-opts first to drop under 10 open PRs per repo.');
}
