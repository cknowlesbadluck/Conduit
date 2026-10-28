#!/usr/bin/env node
// Report-only, portfolio-wide PR hygiene: open-PR counts per repo, age, conflict/CI state,
// docs-only vs code, and CLOSE candidates with reasons. Complements merge-train.mjs (merge
// candidates for one repo) and --entropy (age/stack buckets). Never writes, closes, or merges.
//
// Usage: node scripts/pr-hygiene.mjs [--json] [--repos QuicksilverV1,Conduit,Resonance] [--target 10]
// Auth:  the local `gh` CLI session or GH_TOKEN, used only by `gh` itself (never read or printed).
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IGNORED_CHECKS = new Set(["Workers Builds: conduit"]);
const DAY = 86_400_000;
const GREEN = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const RED = new Set(["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
const NOISE = /(^|\b)(bolt|jules)(\b|\/)|⚡/i;
const STALE_DAYS = 7;

/**
 * Docs-only = every changed file is markdown or under docs/. Empty file lists are NOT docs-only (fail-closed).
 * gh returns at most 100 files; when `changedFiles` is known and exceeds the list, the list is incomplete -> not docs-only.
 */
export function isDocsOnly(files, changedFiles) {
  if (Number.isInteger(changedFiles) && Array.isArray(files) && changedFiles !== files.length) return false;
  return Array.isArray(files) && files.length > 0 && files.every((f) => /^docs\//.test(f?.path ?? "") || /\.md$/i.test(f?.path ?? ""));
}

/** ms since epoch, or 0 for missing / gh zero-time ("0001-01-01T00:00:00Z") values. */
function runTime(v) {
  const t = Date.parse(v ?? "");
  return Number.isFinite(t) && t > 0 ? t : 0;
}

/** Latest conclusion per check name; ignored checks dropped. Returns "green" | "red" | "pending" | "none". */
export function ciState(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return "none";
  const latest = new Map();
  let undatedPending = false; // a queued rerun with no timestamps can't be ordered: never let an older success read as green
  for (const c of rollup) {
    const name = c?.name ?? c?.context ?? "?";
    if (IGNORED_CHECKS.has(name)) continue;
    const at = runTime(c?.startedAt) || runTime(c?.completedAt) || runTime(c?.createdAt); // reruns by start time; commit statuses by createdAt; gh zero-times count as missing
    const raw = String(c?.conclusion || c?.state || c?.status || "").toUpperCase();
    if (!at && !GREEN.has(raw) && !RED.has(raw)) undatedPending = true;
    const key = `${c?.__typename ?? (c?.context !== undefined ? "StatusContext" : "CheckRun")}:${name}`; // check runs and statuses are separate gates
    const prev = latest.get(key);
    if (!prev || at >= prev.at) latest.set(key, { at, c });
  }
  let pending = false;
  for (const { c } of latest.values()) {
    const concl = String(c?.conclusion ?? c?.state ?? "").toUpperCase();
    if (RED.has(concl)) return "red";
    if (!GREEN.has(concl)) pending = true; // in progress, empty, or cancelled: not green yet
  }
  return latest.size === 0 ? "none" : pending || undatedPending ? "pending" : "green";
}

/** Pure per-PR classification. `now` is ms since epoch. */
export function classifyPr(pr, now = Date.now()) {
  const ageDays = Math.floor((now - Date.parse(pr?.createdAt ?? "")) / DAY);
  const idleDays = Math.floor((now - Date.parse(pr?.updatedAt ?? pr?.createdAt ?? "")) / DAY);
  const docsOnly = isDocsOnly(pr?.files, pr?.changedFiles);
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

const AGE_BUCKETS = [["0-1d", 1], ["2-7d", 7], ["8-14d", 14], ["15d+", Infinity]];
/** Pure. Counts per age bucket; unknown ages go to "unknown". */
export function ageBuckets(rows) {
  const out = Object.fromEntries([...AGE_BUCKETS.map(([k]) => [k, 0]), ["unknown", 0]]);
  for (const r of rows) {
    const b = Number.isFinite(r?.ageDays) ? AGE_BUCKETS.find(([, max]) => r.ageDays <= max) : null;
    out[b ? b[0] : "unknown"]++;
  }
  return out;
}

const pathsOf = (pr) => (Array.isArray(pr?.files) ? pr.files.map((f) => f?.path).filter((x) => typeof x === "string" && x) : []);
/** Pure. PR pairs that touch the same file, with the shared paths. */
export function overlapPairs(prs) {
  const list = (prs ?? []).map((p) => ({ n: p?.number, f: new Set(pathsOf(p)) }));
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const shared = [...list[i].f].filter((x) => list[j].f.has(x));
    if (shared.length) out.push({ a: list[i].n, b: list[j].n, files: shared.sort() });
  }
  return out;
}

/**
 * Pure. PRs touching an owner-only path. `isOwnerOnly` comes from the shared owner-only-paths module (#332);
 * without it the count is null ("unknown"), never 0. An empty or incomplete file list counts as owner-only (fail-closed).
 */
export function ownerOnlyCount(prs, isOwnerOnly) {
  if (typeof isOwnerOnly !== "function") return null;
  return (prs ?? []).filter((p) => {
    const files = pathsOf(p);
    if (!files.length || (Number.isInteger(p?.changedFiles) && p.changedFiles !== files.length)) return true;
    return files.some((f) => isOwnerOnly(f));
  }).length;
}

/** Pure repo summary. */
export function summarizeRepo(prs, { now = Date.now(), target = 10, isOwnerOnly } = {}) {
  if (!Array.isArray(prs)) return null;
  const rows = prs.map((p) => classifyPr(p, now)).sort((a, b) => (b.idleDays ?? 0) - (a.idleDays ?? 0));
  const count = (f) => rows.filter(f).length;
  return {
    open: rows.length, overTarget: Math.max(0, rows.length - target), drafts: count((r) => r.draft), stacked: count((r) => r.stacked),
    docsOnly: count((r) => r.docsOnly), conflicting: count((r) => r.conflicting), ciRed: count((r) => r.ci === "red"), ciGreen: count((r) => r.ci === "green"),
    changesRequested: count((r) => r.changesRequested), oldestDays: rows.reduce((m, r) => Math.max(m, r.ageDays ?? 0), 0),
    ageBuckets: ageBuckets(rows), overlaps: overlapPairs(prs), ownerOnly: ownerOnlyCount(prs, isOwnerOnly),
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
  out.push("", "| Repo | Age buckets (0-1d / 2-7d / 8-14d / 15d+) | Overlap pairs | Owner-only |", "|---|---|---|---|");
  for (const [repo, s] of Object.entries(report ?? {})) {
    const name = String(repo).replace(/[^A-Za-z0-9._-]/g, "");
    if (!s) { out.push(`| ${name} | unavailable | | |`); continue; }
    const b = s.ageBuckets ?? {};
    out.push(`| ${name} | ${b["0-1d"]} / ${b["2-7d"]} / ${b["8-14d"]} / ${b["15d+"]} | ${(s.overlaps ?? []).map((o) => `#${o.a}×#${o.b}`).join(" ") || "-"} | ${s.ownerOnly ?? "unknown"} |`);
  }
  return out.join("\n");
}

/** Loads the shared owner-only predicate (#332) if present; null otherwise (counts render as "unknown"). */
export async function loadOwnerOnly(load = () => import("./owner-only-paths.mjs")) {
  try { const m = await load(); return typeof m?.isOwnerOnlyPath === "function" ? m.isOwnerOnlyPath : null; } catch { return null; }
}

const FIELDS = "number,title,headRefName,baseRefName,isDraft,mergeable,reviewDecision,createdAt,updatedAt,files,changedFiles,statusCheckRollup";
const FETCH_LIMIT = 500;
/** null (unavailable) on any error, and when the list reaches FETCH_LIMIT (possibly truncated): never a partial total. */
export function fetchOpenPrs(repo, { owner = "cknowlesbadluck", exec = execFileSync, limit = FETCH_LIMIT } = {}) {
  try {
    const out = exec("gh", ["pr", "list", "-R", `${owner}/${repo}`, "--state", "open", "--limit", String(limit), "--json", FIELDS], { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    const data = JSON.parse(out);
    return Array.isArray(data) && data.length < limit ? data : null;
  } catch { return null; }
}

const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const repos = arg("--repos", "QuicksilverV1,Conduit,Resonance").split(",").filter((r) => /^[A-Za-z0-9._-]+$/.test(r));
  const rawTarget = arg("--target", "10");
  const target = Number(rawTarget);
  if (!/^\d+$/.test(String(rawTarget)) || !Number.isSafeInteger(target)) { console.error("--target must be a non-negative integer"); process.exit(2); }
  const report = {};
  const isOwnerOnly = await loadOwnerOnly();
  for (const repo of repos) report[repo] = summarizeRepo(fetchOpenPrs(repo), { target, isOwnerOnly });
  if (process.argv.includes("--json")) console.log(JSON.stringify({ at: new Date().toISOString(), target, report }, null, 2));
  else {
    console.log(hygieneMarkdown(report));
    for (const [repo, s] of Object.entries(report)) for (const c of s?.closeCandidates ?? []) console.log(`${repo} #${c.number}: ${c.reasons.join(", ")} — ${c.title}`);
  }
}
