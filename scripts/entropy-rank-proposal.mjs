#!/usr/bin/env node
/**
 * Entropy rank proposal — innovation from 2026-11-12 06:00Z portfolio audit.
 * Rank open PRs by age + docs-only + overlap heuristic + CI status for close candidates.
 * Read-only. Requires GH_TOKEN. Never merges or closes.
 * Usage: node scripts/entropy-rank-proposal.mjs
 */
console.log('Entropy rank proposal loaded. Integrate with existing entropy-score.mjs for daily close-candidate reports.');
console.log('Formula: score = ageDays * 2 + (docsOnly ? 10 : 0) + (overlap ? 5 : 0) - (ciGreen ? 8 : 0)');
console.log('Target: surface pure noise for owner confirmation close. Do not auto-close.');
