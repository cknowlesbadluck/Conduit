#!/usr/bin/env node
// Report-only, portfolio-wide PR hygiene: open-PR counts per repo, age, conflict/CI state,
// docs-only vs code, and CLOSE candidates with reasons. Complements merge-train.mjs (merge
// candidates for one repo) and --entropy (age/stack buckets). Never writes, closes, or merges.
//
// Usage: node scripts/pr-hygiene.mjs [--json] [--repos QuicksilverV1,Conduit,Resonance] [--target 10]
// Auth:  the local `gh` CLI session or GH_TOKEN, used only by `gh` itself (never read or printed).
import { execFileSync } from "node:child_process";

export const IGNORED_CHECKS = new Set(["Workers Builds: conduit"]);
const DAY = 86_400_000;
const GREEN = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const RED = new Set(["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
export const NOISE = /(^|\b)(bolt|jules)(\b|\/)|⚡/i;
export const STALE_DAYS = 7;

/** Docs-only = every changed file is markdown or under docs/. Empty file lists are NOT docs-only (fail-closed). */
export function isDocsOnly(files) {
  return Array.isArray(files) && files.length > 0 && files.every((f) => /^docs\//.test(f?.path ?? "") || /\.md$/i.test(f?.path ?? ""));
}

/** Latest conclusion per check name; ignored checks dropped. Returns "green" | "red" | "pending" | "none". */
export function ciState(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return "none";
  const latest = new Map();
  for (const c of rollup) {
    const name = c?.name ?? c?.context ?? "?";
    if (IGNORED_CHECKS.has(name)) continue;
    const at = Date.parse(c?.completedAt ?? c?.startedAt ?? "") || 0;
    const prev = latest.get(name);
    if (!prev || at >= prev.at) latest.set(name, { at, c });
  }
  let pending = false;
  for (const { c } of latest.values()) {
    const concl = String(c?.conclusion ?? c?.state ?? "").toUpperCase();
    if (RED.has(concl)) return "red";
    if (!GREEN.has(concl)) pending = true; // in progress, empty, or cancelled: not green yet
  }
  return latest.size === 0 ? "none" : pending ? "pending" : "green";
}

/** Pure per-PR classification. `now` is ms since epoch. */
export function classifyPr(pr, now = Date.now()) {
  const ageDays = Math.floor((now - Date.parse(pr?.createdAt ?? "")) / DAY);
  const idleDays = Math.floor((now - Date.parse(pr?.updatedAt ?? pr?.createdAt ?? "")) / DAY);
  const docsOnly = isDocsOnly(pr?.files);
  const conflicting = pr?.mergeable === "CONFLICTING";
  const ci = ciState(pr?.statusCheckRollup);
  const changesRequested = pr?.reviewDecision === "CHANGES_REQUESTED";
  const noise = NOISE.test(`${pr?.title ?? ""} ${pr?.headRefName ?? ""}`);
  const reasons = [];
  if (noise) reasons.push("bolt_jules_micro_opt");
  if (conflicting && Number.isFinite(idleDays) && idleDays >= STALE_DAYS) reasons.push(`conflicting_idle_${idleDays}d`);
  if (docsOnly && conflicting) reasons.push("docs_only_conflicting");
  if (changesRequested && Number.isFinite(idleDays) && idleDays >= STALE_DAYS && !pr?.isDraft) reasons.push(`changes_requested_idle_${idleDays}d`);
  return {
    number: pr?.number, title: String(pr?.title ?? "").slice(0, 100), ageDays: Number.isFinite(ageDays) ? ageDays : null, idleDays: Number.isFinite(idleDays) ? idleDays : null,
    draft: Boolean(pr?.isDraft), stacked: Boolean(pr?.baseRefName && pr.baseRefName !== "main"), docsOnly, conflicting, ci, changesRequested,
    closeCandidate: reasons.length > 0, reasons,
  };
}

/** Pure repo summary. */
export function summarizeRepo(prs, { now = Date.now(), target = 10 } = {}) {
  if (!Array.isArray(prs)) return null;
  const rows = prs.map((p) => classifyPr(p, now)).sort((a, b) => (b.idleDays ?? 0) - (a.idleDays ?? 0));
  const count = (f) => rows.filter(f).length;
  return {
    open: rows.length, overTarget: Math.max(0, rows.length - target), drafts: count((r) => r.draft), stacked: count((r) => r.stacked),
    docsOnly: count((r) => r.docsOnly), conflicting: count((r) => r.conflicting), ciRed: count((r) => r.ci === "red"), ciGreen: count((r) => r.ci === "green"),
    changesRequested: count((r) => r.changesRequested), oldestDays: rows.reduce((m, r) => Math.max(m, r.ageDays ?? 0), 0),
    closeCandidates: rows.filter((r) => r.closeCandidate).map((r) => ({ number: r.number, reasons: r.reasons, title: r.title })), rows,
  };
}

export function hygieneMarkdown(report) {
  const out = ["| Repo | Open | Over target | Docs-only | Conflicting | CI red | Changes req. | Oldest (d) | Close candidates |", "|---|---|---|---|---|---|---|---|---|"];
  for (const [repo, s] of Object.entries(report ?? {})) {
    const name = String(repo).replace(/[^A-Za-z0-9._-]/g, "");
    if (!s) { out.push(`| ${name} | unavailable | | | | | | | |`); continue; }
    out.push(`| ${name} | ${s.open} | ${s.overTarget} | ${s.docsOnly} | ${s.conflicting} | ${s.ciRed} | ${s.changesRequested} | ${s.oldestDays} | ${s.closeCandidates.map((c) => `#${c.number}`).join(" ") || "-"} |`);
  }
  return out.join("\n");
}

const FIELDS = "number,title,headRefName,baseRefName,isDraft,mergeable,reviewDecision,createdAt,updatedAt,files,statusCheckRollup";
export function fetchOpenPrs(repo, { owner = "cknowlesbadluck", exec = execFileSync } = {}) {
  try {
    const out = exec("gh", ["pr", "list", "-R", `${owner}/${repo}`, "--state", "open", "--limit", "200", "--json", FIELDS], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "ignore"] });
    const data = JSON.parse(out);
    return Array.isArray(data) ? data : null;
  } catch { return null; }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const repos = arg("--repos", "QuicksilverV1,Conduit,Resonance").split(",").filter((r) => /^[A-Za-z0-9._-]+$/.test(r));
  const target = Number(arg("--target", "10")) || 10;
  const report = {};
  for (const repo of repos) report[repo] = summarizeRepo(fetchOpenPrs(repo), { target });
  if (process.argv.includes("--json")) console.log(JSON.stringify({ at: new Date().toISOString(), target, report }, null, 2));
  else {
    console.log(hygieneMarkdown(report));
    for (const [repo, s] of Object.entries(report)) for (const c of s?.closeCandidates ?? []) console.log(`${repo} #${c.number}: ${c.reasons.join(", ")} — ${c.title}`);
  }
}
