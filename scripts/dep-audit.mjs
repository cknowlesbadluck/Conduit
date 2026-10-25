#!/usr/bin/env node
/**
 * Read-only dependency audit gate over `npm audit --json` (registry advisory DB; free, no token).
 * Fails (exit 1) when any advisory at or above --level (default: high) affects the tree,
 * optionally only production deps (--omit-dev). Unparseable / missing audit output fails
 * closed (exit 2): "could not audit" is never reported as "clean".
 * Usage: node scripts/dep-audit.mjs [--level low|moderate|high|critical] [--omit-dev] [--json]
 *        npm audit --json | node scripts/dep-audit.mjs --stdin
 * No env vars, no writes, no `npm audit fix`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LEVELS = ["info", "low", "moderate", "high", "critical"];

/** Pure: evaluate an npm audit v2 report. Returns { ok, error?, counts, offending }. */
export function evaluateAudit(report, level = "high") {
  const min = LEVELS.indexOf(level);
  if (min < 0) throw new Error(`unknown level: ${level}`);
  const meta = report?.metadata?.vulnerabilities;
  if (!report || typeof report !== "object" || report.auditReportVersion !== 2 || !meta || typeof meta !== "object") {
    return { ok: false, error: report?.error?.summary || report?.message || "unreadable npm audit report (expected auditReportVersion 2)", counts: null, offending: [] };
  }
  const counts = Object.fromEntries(LEVELS.map((l) => [l, Number.isInteger(meta[l]) ? meta[l] : null]));
  if (Object.values(counts).some((n) => n === null)) return { ok: false, error: "audit metadata missing severity counts", counts, offending: [] };
  const offending = Object.values(report.vulnerabilities ?? {})
    .filter((v) => LEVELS.indexOf(v?.severity) >= min)
    .map((v) => ({ name: v.name, severity: v.severity, direct: Boolean(v.isDirect), fixAvailable: Boolean(v.fixAvailable), range: v.range ?? "" }))
    .sort((a, b) => LEVELS.indexOf(b.severity) - LEVELS.indexOf(a.severity) || a.name.localeCompare(b.name));
  const countAtOrAbove = LEVELS.slice(min).reduce((s, l) => s + counts[l], 0);
  // Fail closed if the summary counts and the per-package list disagree in the dangerous direction.
  return { ok: countAtOrAbove === 0 && offending.length === 0, counts, offending };
}

export function formatAudit(r, level) {
  if (r.error) return `dep-audit: FAIL-CLOSED: ${r.error}`;
  const c = LEVELS.map((l) => `${l}=${r.counts[l]}`).join(" ");
  const head = `dep-audit (>= ${level}): ${r.ok ? "PASS" : "FAIL"}: ${c}`;
  return [head, ...r.offending.map((o) => `  ${o.severity.padEnd(8)} ${o.name}${o.direct ? " (direct)" : ""} ${o.range}${o.fixAvailable ? " [fix available]" : ""}`)].join("\n");
}

function parseArgs(argv) {
  const o = { level: "high", omitDev: false, json: false, stdin: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--level") o.level = argv[++i];
    else if (a === "--omit-dev") o.omitDev = true;
    else if (a === "--json") o.json = true;
    else if (a === "--stdin") o.stdin = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!LEVELS.includes(o.level)) throw new Error(`--level must be one of ${LEVELS.join(", ")}`);
  return o;
}

/** npm audit exits non-zero when it finds advisories; the JSON on stdout is still the report. */
export function runNpmAudit(omitDev, exec = execFileSync) {
  const args = ["audit", "--json", ...(omitDev ? ["--omit=dev"] : [])];
  try { return exec("npm", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { if (e?.stdout) return String(e.stdout); throw e; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`dep-audit: ${e.message}`); process.exit(2); }
  let report;
  try { report = JSON.parse(o.stdin ? readFileSync(0, "utf8") : runNpmAudit(o.omitDev)); }
  catch (e) { console.error(`dep-audit: FAIL-CLOSED: ${String(e?.message ?? e).split("\n")[0]}`); process.exit(2); }
  const r = evaluateAudit(report, o.level);
  console.log(o.json ? JSON.stringify({ level: o.level, ...r }, null, 2) : formatAudit(r, o.level));
  process.exit(r.error ? 2 : r.ok ? 0 : 1);
}
