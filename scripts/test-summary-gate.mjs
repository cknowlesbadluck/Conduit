#!/usr/bin/env node
/**
 * Fail-closed gate over `node --test` TAP output. `# fail 0` alone can hide tests that never
 * ran (cancelled, e.g. a hung hook or a file that crashed before reporting). This fails when:
 *   - no `# tests N` summary line is found (output truncated / runner crashed),
 *   - `# fail` > 0, `# cancelled` > 0, or `# tests` is 0.
 * Read-only: reads a file path (or stdin), no network, no env.
 * Usage: node scripts/test-summary-gate.mjs <tap-output.txt>
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function parseSummary(text) {
  const out = {};
  for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
    // Use the last occurrence: the final top-level summary.
    const all = [...String(text).matchAll(new RegExp(`^(?:#|ℹ)\\s*${key}\\s+(\\d+)\\s*$`, "gm"))];
    if (all.length) out[key] = Number(all[all.length - 1][1]);
  }
  return out;
}

export function evaluate(text) {
  const s = parseSummary(text);
  const reasons = [];
  if (s.tests === undefined) reasons.push("no '# tests' summary found (runner crashed or output truncated)");
  else if (s.tests === 0) reasons.push("zero tests ran");
  if (s.fail === undefined && s.tests !== undefined) reasons.push("no '# fail' summary line");
  if ((s.fail ?? 0) > 0) reasons.push(`fail=${s.fail}`);
  if (s.cancelled === undefined && s.tests !== undefined) reasons.push("no '# cancelled' summary line");
  if ((s.cancelled ?? 0) > 0) reasons.push(`cancelled=${s.cancelled} (tests that never completed)`);
  return { ok: reasons.length === 0, summary: s, reasons };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  const text = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
  const r = evaluate(text);
  console.log(`test-summary-gate: ${JSON.stringify(r.summary)}`);
  if (!r.ok) {
    console.error(`test-summary-gate: FAIL - ${r.reasons.join("; ")}`);
    process.exit(1);
  }
  console.log("test-summary-gate: ok");
}
