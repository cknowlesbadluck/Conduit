#!/usr/bin/env node
/**
 * Read-only open-PR entropy trend gate.
 * Compares current open-PR counts against a committed baseline JSON and
 * fails (exit 1) if any repo grew by more than --max-growth (default 3).
 * Unknown current counts (null) are reported as "unknown" and never fail.
 * Usage: node scripts/entropy-trend.mjs [--baseline path] [--max-growth N] [--json]
 * No env vars, no writes; uses the unauthenticated public search API via openPrCounts().
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const DEFAULT_BASELINE = new URL("../docs/baselines/pr-entropy-baseline.json", import.meta.url);

/** Pure: compare current counts to baseline counts. */
export function entropyTrend(baseline, current, maxGrowth = 3) {
  if (!Number.isInteger(maxGrowth) || maxGrowth < 0) throw new Error("maxGrowth must be a non-negative integer");
  const base = baseline?.counts ?? {};
  const repos = [...new Set([...Object.keys(base), ...Object.keys(current ?? {})])].sort();
  const rows = repos.map((repo) => {
    const b = Number.isInteger(base[repo]) ? base[repo] : null;
    const c = Number.isInteger(current?.[repo]) ? current[repo] : null;
    if (b === null || c === null) return { repo, baseline: b, current: c, delta: null, status: "unknown" };
    const delta = c - b;
    return { repo, baseline: b, current: c, delta, status: delta > maxGrowth ? "grew" : delta < 0 ? "shrank" : "steady" };
  });
  return { maxGrowth, ok: rows.every((r) => r.status !== "grew"), rows };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const baseline = JSON.parse(await readFile(arg("--baseline") ?? DEFAULT_BASELINE, "utf8"));
  const maxGrowth = arg("--max-growth") === undefined ? 3 : Number(arg("--max-growth"));
  const { openPrCounts } = await import("./portfolio-probe.mjs");
  const report = entropyTrend(baseline, await openPrCounts({ repos: Object.keys(baseline.counts ?? {}) }), maxGrowth);
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else for (const r of report.rows) console.log(`${r.repo}: ${r.baseline ?? "?"} -> ${r.current ?? "?"} (${r.delta ?? "?"}) ${r.status}`);
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
