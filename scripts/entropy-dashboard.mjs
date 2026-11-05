#!/usr/bin/env node
/**
 * Entropy Dashboard — report-only scorer for open PRs across the portfolio.
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/entropy-dashboard.mjs
 *   or: node scripts/entropy-dashboard.mjs   (uses `gh` auth if available)
 *   node scripts/entropy-dashboard.mjs --json   (machine-readable for CI)
 *
 * Outputs ranked close/merge candidates. Does not modify anything.
 * Scores: age (days), docs-only, Jules origin, title keywords.
 */

const REPOS = [
  'cknowlesbadluck/QuicksilverV1',
  'cknowlesbadluck/Resonance',
  'cknowlesbadluck/Conduit',
];

const JULES_MARKERS = ['⚡ Bolt:', 'Jules', 'localeCompare', 'sameRecord', 'microbenchmark'];
const DOCS_MARKERS = ['docs:', 'AUDIT-', 'ROADMAP', 'hygiene:', 'mirror'];
const HARDEN_MARKERS = ['harden', 'fix(', 'test(', 'privacy', '401', 'redact', 'bound', 'cap'];

async function gh(args) {
  const { execSync } = await import('child_process');
  try {
    return execSync(`gh ${args}`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch (e) {
    console.error('gh failed:', e.message);
    process.exit(1);
  }
}

function score(pr) {
  let s = 0;
  const title = (pr.title || '').toLowerCase();
  const body = (pr.body || '').toLowerCase();
  const created = new Date(pr.createdAt);
  const ageDays = Math.floor((Date.now() - created) / 86400000);
  s += Math.min(ageDays, 30);

  if (JULES_MARKERS.some(m => title.includes(m.toLowerCase()) || body.includes(m.toLowerCase()))) {
    s += 40;
  }
  if (DOCS_MARKERS.some(m => title.includes(m.toLowerCase()))) {
    s += 25;
  }
  if (HARDEN_MARKERS.some(m => title.includes(m.toLowerCase()))) {
    s -= 15;
  }
  if (pr.draft) s += 10;
  if ((pr.comments || 0) > 5) s += 5;
  return { score: s, ageDays, isJules: s > 35, isDocs: title.includes('docs') };
}

async function main() {
  const jsonMode = process.argv.includes('--json');
  const all = [];
  for (const repo of REPOS) {
    const raw = await gh(`pr list --repo ${repo} --state open --limit 100 --json number,title,body,createdAt,author,comments,draft,url,labels`);
    const prs = JSON.parse(raw);
    for (const pr of prs) {
      const sc = score(pr);
      all.push({ repo, number: pr.number, title: pr.title, url: pr.url, ...sc, draft: pr.draft });
    }
  }

  all.sort((a, b) => b.score - a.score);

  if (jsonMode) {
    const summary = {
      total: all.length,
      byRepo: {},
      topCloseCandidates: all.slice(0, 25).map(p => ({
        score: p.score,
        repo: p.repo,
        number: p.number,
        ageDays: p.ageDays,
        title: p.title,
        url: p.url,
        tags: [p.isJules && 'JULES', p.isDocs && 'DOCS', p.draft && 'DRAFT'].filter(Boolean)
      }))
    };
    for (const p of all) {
      summary.byRepo[p.repo] = (summary.byRepo[p.repo] || 0) + 1;
    }
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('\n=== Portfolio Entropy Dashboard ===');
  console.log(`Total open PRs: ${all.length}`);
  console.log(`Target: <10 per repo\n`);

  console.log('Top close candidates (high score = prune first):\n');
  all.slice(0, 25).forEach((p, i) => {
    const tags = [p.isJules && 'JULES', p.isDocs && 'DOCS', p.draft && 'DRAFT'].filter(Boolean).join(',');
    console.log(`${i + 1}. [${p.score}] ${p.repo}#${p.number} (${p.ageDays}d) ${tags}`);
    console.log(`   ${p.title}`);
    console.log(`   ${p.url}\n`);
  });

  const byRepo = {};
  for (const p of all) {
    byRepo[p.repo] = (byRepo[p.repo] || 0) + 1;
  }
  console.log('Counts:');
  Object.entries(byRepo).forEach(([r, c]) => console.log(`  ${r}: ${c}`));
}

main().catch(console.error);
