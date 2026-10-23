#!/usr/bin/env node
/**
 * Hygiene PR Reporter — read-only, free, uses gh CLI.
 * Reports open PR counts and lists pure docs/audit/roadmap PRs for potential close.
 * Does not close or modify anything.
 *
 * Usage: node scripts/hygiene-pr-reporter.mjs
 * Requires: gh auth
 */

import { execSync } from 'child_process';

const REPOS = [
  'cknowlesbadluck/QuicksilverV1',
  'cknowlesbadluck/Conduit',
  'cknowlesbadluck/Resonance'
];

function getOpenPRs(repo) {
  try {
    const out = execSync(`gh pr list --repo ${repo} --state open --json number,title,createdAt --limit 100`, { encoding: 'utf8' });
    return JSON.parse(out);
  } catch (e) {
    return [];
  }
}

console.log('# Portfolio Hygiene PR Report — ' + new Date().toISOString());
console.log('Read-only. Suggests close for pure docs/audit/roadmap PRs that are superseded.\n');

for (const repo of REPOS) {
  const prs = getOpenPRs(repo);
  console.log(`## ${repo}: ${prs.length} open PRs`);
  const docs = prs.filter(p => /docs|audit|roadmap|hygiene|mirror/i.test(p.title));
  if (docs.length) {
    console.log('Potential docs/hygiene candidates (review before close):');
    docs.forEach(p => console.log(`  #${p.number} ${p.title} (${p.createdAt})`));
  }
  console.log('');
}

console.log('Highest-value next: close pure superseded docs PRs to reduce entropy, then owner gates.');
