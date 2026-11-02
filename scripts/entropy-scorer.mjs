#!/usr/bin/env node
/**
 * Entropy Scorer — identify high-entropy / low-value open PRs for hygiene prune.
 * Scores by age, title keywords (Bolt, docs, audit, micro), draft status.
 * Usage: node scripts/entropy-scorer.mjs --owner cknowlesbadluck --repo Conduit
 * Requires GITHUB_TOKEN in env for live API (falls back to static demo).
 */
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const owner = args.find(a => a.startsWith('--owner='))?.split('=')[1] || 'cknowlesbadluck';
const repo = args.find(a => a.startsWith('--repo='))?.split('=')[1] || 'Conduit';

function scorePR(pr) {
  let score = 0;
  const title = (pr.title || '').toLowerCase();
  const ageDays = (Date.now() - new Date(pr.created_at || Date.now()).getTime()) / 86400000;
  if (title.includes('bolt') || title.includes('⚡')) score += 40;
  if (title.includes('docs') || title.includes('audit') || title.includes('hygiene')) score += 25;
  if (title.includes('micro') || title.includes('optimize') || title.includes('fast')) score += 15;
  if (pr.draft) score += 10;
  if (ageDays > 14) score += 20;
  if (ageDays > 30) score += 15;
  if ((pr.changed_files || 0) <= 2 && (pr.additions || 0) + (pr.deletions || 0) < 30) score += 10;
  return { number: pr.number, title: pr.title, score, ageDays: Math.round(ageDays), url: pr.html_url };
}

async function main() {
  let prs = [];
  try {
    // Prefer gh CLI if available
    const out = execSync(`gh pr list --repo ${owner}/${repo} --state open --limit 100 --json number,title,createdAt,draft,changedFiles,additions,deletions,url`, { encoding: 'utf8' });
    prs = JSON.parse(out).map(p => ({
      number: p.number,
      title: p.title,
      created_at: p.createdAt,
      draft: p.draft,
      changed_files: p.changedFiles,
      additions: p.additions,
      deletions: p.deletions,
      html_url: p.url
    }));
  } catch (e) {
    console.error('gh CLI failed or no token; using demo mode');
    prs = [
      { number: 344, title: '⚡ Bolt: Fast direct ISO 8601 timestamp sorting', created_at: '2026-11-01T09:02:24Z', draft: false, changed_files: 2, additions: 14, deletions: 8, html_url: 'https://example.com' },
      { number: 251, title: 'harden(logs): redact raw DB errors', created_at: '2026-10-26T00:00:00Z', draft: false, changed_files: 5, additions: 50, deletions: 20, html_url: 'https://example.com' }
    ];
  }
  const scored = prs.map(scorePR).sort((a, b) => b.score - a.score);
  console.log(`Entropy candidates for ${owner}/${repo} (higher score = better close candidate):`);
  scored.slice(0, 10).forEach(s => {
    console.log(`#${s.number} score=${s.score} age=${s.ageDays}d  ${s.title}`);
    console.log(`  ${s.url}`);
  });
  console.log(`\nTotal open: ${prs.length}. Target <10. High-score items are prune candidates (review before close).`);
}

main().catch(console.error);
