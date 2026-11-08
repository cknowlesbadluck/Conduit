#!/usr/bin/env node
/**
 * Entropy Dashboard — report-only scorer for open PRs across the portfolio.
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/entropy-dashboard.mjs
 *   or: node scripts/entropy-dashboard.mjs   (uses `gh` auth if available)
 *   node scripts/entropy-dashboard.mjs --json   (machine-readable for CI)
 *   node scripts/entropy-dashboard.mjs --close-candidates   (focus on high-score prune list)
 *
 * Outputs ranked close/merge candidates. Does not modify anything.
 * Scores: age (days), docs-only, Jules origin, title keywords, draft status.
 * Higher score = stronger close candidate (noise, old, micro-opt).
 */

const REPOS = [
  'cknowlesbadluck/QuicksilverV1',
  'cknowlesbadluck/Resonance',
  'cknowlesbadluck/Conduit',
];

const JULES_MARKERS = ['⚡ Bolt:', 'Jules', 'localeCompare', 'sameRecord', 'microbenchmark', 'optimize', 'bolt:'];
const DOCS_MARKERS = ['docs:', 'AUDIT-', 'ROADMAP', 'hygiene:', 'mirror', 'portfolio'];
const HARDEN_MARKERS = ['harden', 'fix(', 'test(', 'privacy', '401', 'redact', 'bound', 'cap', 'security', 'auth'];
const NOISE_MARKERS = ['mirror', 'docs: portfolio', 'chore: migrate', 'fix: update gemini'];

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
  s += Math.min(ageDays * 1.5, 45); // weight age higher

  if (JULES_MARKERS.some(m => title.includes(m.toLowerCase()) || body.includes(m.toLowerCase()))) {
    s += 45;
  }
  if (DOCS_MARKERS.some(m => title.includes(m.toLowerCase()))) {
    s += 30;
  }
  if (NOISE_MARKERS.some(m => title.includes(m.toLowerCase()))) {
    s += 20;
  }
  if (HARDEN_MARKERS.some(m => title.includes(m.toLowerCase()))) {
    s -= 20; // prefer to keep hardens
  }
  if (pr.draft) s += 15;
  if ((pr.comments || 0) > 8) s += 8;
  // Bonus for pure docs or very old
  if (ageDays > 14 && DOCS_MARKERS.some(m => title.includes(m.toLowerCase()))) s += 15;

  return { score: Math.round(s), ageDays, isJules: s > 40, isDocs: title.includes('docs') || title.includes('mirror'), isNoise: s > 50 };
}

async function main() {
  const jsonMode = process.argv.includes('--json');
  const closeMode = process.argv.includes('--close-candidates');
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

  const closeCandidates = all.filter(p => p.score >= 40 || p.isNoise || (p.isDocs && p.ageDays > 7));

  if (jsonMode) {
    const summary = {
      total: all.length,
      closeCandidateCount: closeCandidates.length,
      byRepo: {},
      topCloseCandidates: closeCandidates.slice(0, 30).map(p => ({
        score: p.score,
        repo: p.repo,
        number: p.number,
        ageDays: p.ageDays,
        title: p.title,
        url: p.url,
        tags: [p.isJules && 'JULES', p.isDocs && 'DOCS', p.isNoise && 'NOISE', p.draft && 'DRAFT'].filter(Boolean)
      }))
    };
    for (const p of all) {
      summary.byRepo[p.repo] = (summary.byRepo[p.repo] || 0) + 1;
    }
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (closeMode) {
    console.log('\n=== Close Candidates (score >=40 or noise/docs) ===');
    console.log(`Found ${closeCandidates.length} strong prune candidates\n`);
    closeCandidates.slice(0, 20).forEach((p, i) => {
      const tags = [p.isJules && 'JULES', p.isDocs && 'DOCS', p.isNoise && 'NOISE', p.draft && 'DRAFT'].filter(Boolean).join(',');
      console.log(`${i + 1}. [${p.score}] ${p.repo}#${p.number} (${p.ageDays}d) ${tags}`);
      console.log(`   ${p.title}`);
      console.log(`   ${p.url}\n`);
    });
    return;
  }

  console.log('\n=== Portfolio Entropy Dashboard ===');
  console.log(`Total open PRs: ${all.length}`);
  console.log(`Target: <10 per repo`);
  console.log(`Strong close candidates: ${closeCandidates.length}\n`);

  console.log('Top close candidates (high score = prune first):\n');
  all.slice(0, 25).forEach((p, i) => {
    const tags = [p.isJules && 'JULES', p.isDocs && 'DOCS', p.isNoise && 'NOISE', p.draft && 'DRAFT'].filter(Boolean).join(',');
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
  console.log('\nRun with --close-candidates for focused prune list.');
}

main().catch(console.error);
