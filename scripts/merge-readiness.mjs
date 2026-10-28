#!/usr/bin/env node
// Read-only merge-readiness check encoding the owner's Conduit squash-merge criteria.
// Never merges, comments, or resolves anything: it only reads PR state via `gh`.
// Usage: node scripts/merge-readiness.mjs <pr> [<pr> ...] [--repo owner/name] [--json]
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { OWNER_ONLY_PATHS, isOwnerOnlyPath } from "./owner-only-paths.mjs";

export const IGNORED_CHECKS = new Set(["Workers Builds: conduit"]);
export const NEVER_MERGE = new Set([206, 212, 234, 238, 243, 209, 155, 120, 321]);
// Owner-only surfaces: single shared source with merge-train (scripts/owner-only-paths.mjs) so the gates cannot drift.
export const SENSITIVE = OWNER_ONLY_PATHS;
const GREEN = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

const SNAKE = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9]\b/g;
/** Per line: a concrete VAR=value always counts; a generic env-var phrase counts unless that line is a "no env vars" disclaimer;
 * a standalone SCREAMING_SNAKE name counts unless the PR's own diff declares it as a code constant (codeConstants). Fail-closed:
 * with no diff evidence (empty set) every such name counts. */
export function envVarMentioned(body, codeConstants = new Set()) {
  return String(body ?? "").split(/\r?\n/).some((line) =>
    /\b[A-Z][A-Z0-9_]*=/.test(line) || (line.match(SNAKE) ?? []).some((n) => !codeConstants.has(n)) ||
    (/new env var|environment variable|env vars?\b/i.test(line) && !/\bno (new )?env(ironment)? var(iable)?s?\b/i.test(line)));
}

/** Pure. SCREAMING_SNAKE names the diff declares as `const NAME =` on an added line, minus any name the diff also reads from env. */
export function declaredConstants(diff) {
  const text = String(diff ?? ""), out = new Set();
  for (const m of text.matchAll(/^\+(?!\+\+).*?\bconst\s+([A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9])\s*=/gm)) out.add(m[1]);
  for (const n of [...out]) if (new RegExp(`env(\\.|\\[["'\`])${n}\\b`).test(text)) out.delete(n);
  return out;
}

/** Pure. pr = { number, isDraft, mergeable, reviews:[{author,state}], checks:[{name,conclusion|state}], files:[path], behindBy, unresolvedThreads, body } */
export function evaluate(pr) {
  const blockers = [];
  if (!pr || !Number.isInteger(pr.number)) return { ready: false, blockers: ["invalid_input"] };
  if (pr.state !== "OPEN") blockers.push(`state_${String(pr.state ?? "unknown").toLowerCase()}`); // closed/merged PRs can still report MERGEABLE
  if (NEVER_MERGE.has(pr.number)) blockers.push("never_merge_list");
  if (pr.isDraft) blockers.push("draft");
  if (pr.baseRefName !== "main") blockers.push(`base_not_main:${pr.baseRefName ?? "unknown"}`);
  if (pr.mergeable !== "MERGEABLE") blockers.push(`mergeable_${String(pr.mergeable ?? "unknown").toLowerCase()}`);
  if (!Number.isInteger(pr.behindBy)) blockers.push("behind_unknown");
  else if (pr.behindBy > 0) blockers.push(`behind_${pr.behindBy}`);
  // Latest review per author; any standing CHANGES_REQUESTED blocks (bot reviews are never dismissed).
  const latest = new Map();
  for (const r of pr.reviews ?? []) if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(r?.state)) latest.set(r.author, r.state);
  for (const [a, s] of latest) if (s === "CHANGES_REQUESTED") blockers.push(`changes_requested:${a}`);
  if (!Number.isInteger(pr.unresolvedThreads)) blockers.push("threads_unknown");
  else if (pr.unresolvedThreads > 0) blockers.push(`unresolved_threads_${pr.unresolvedThreads}`);
  const checks = (pr.checks ?? []).filter((c) => !IGNORED_CHECKS.has(c?.name));
  if (checks.length === 0) blockers.push("no_checks");
  for (const c of checks) {
    const s = String(c?.conclusion || c?.state || "PENDING").toUpperCase();
    if (!GREEN.has(s)) blockers.push(`check_${s.toLowerCase()}:${c.name}`);
  }
  if (!Array.isArray(pr.files) || pr.files.length === 0) blockers.push("files_unknown");
  else for (const f of pr.files) if (isOwnerOnlyPath(f)) { blockers.push(`sensitive_path:${f}`); }
  if (envVarMentioned(pr.body, pr.codeConstants)) blockers.push("mentions_env_vars");
  if (Number.isInteger(pr.changedFiles) && Array.isArray(pr.files) && pr.files.length < pr.changedFiles) blockers.push("files_incomplete");
  return { ready: blockers.length === 0, blockers };
}

function gh(args) { return execFileSync("gh", args, { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }

export function fetchPr(repo, number, run = gh) {
  try {
    const [owner, name] = repo.split("/");
    const v = JSON.parse(run(["pr", "view", String(number), "-R", repo, "--json", "number,state,isDraft,mergeable,headRefName,headRefOid,baseRefName,changedFiles,body,reviews,statusCheckRollup"]));
    const behindBy = JSON.parse(run(["api", `repos/${repo}/compare/main...${v.headRefOid}`, "--jq", "{b:.behind_by}"])).b;
    const q = `query($o:String!,$n:String!,$p:Int!,$c:String){repository(owner:$o,name:$n){pullRequest(number:$p){reviewThreads(first:100,after:$c){nodes{isResolved} pageInfo{hasNextPage endCursor}}}}}`;
    // REST files endpoint, paginated; include previous_filename so a rename out of a sensitive path is still gated.
    const files = [...new Set(String(run(["api", "--paginate", `repos/${repo}/pulls/${number}/files?per_page=100`, "--jq", ".[] | .filename, (.previous_filename // empty)"])).split("\n").filter(Boolean))];
    let unresolvedThreads = 0, cursor = null;
    for (let page = 0; page < 50; page++) {
      const args = ["api", "graphql", "-f", `query=${q}`, "-f", `o=${owner}`, "-f", `n=${name}`, "-F", `p=${number}`];
      if (cursor) args.push("-f", `c=${cursor}`);
      const rt = JSON.parse(run(args)).data.repository.pullRequest.reviewThreads;
      unresolvedThreads += rt.nodes.filter((x) => !x.isResolved).length;
      if (!rt.pageInfo?.hasNextPage) { cursor = null; break; }
      if (!rt.pageInfo.endCursor) throw new Error("review thread pagination: hasNextPage without endCursor");
      cursor = rt.pageInfo.endCursor;
    }
    if (cursor) throw new Error("too many review thread pages");
    let codeConstants = new Set();
    try { codeConstants = declaredConstants(run(["pr", "diff", String(number), "-R", repo])); } catch { /* fail-closed: no exemptions */ }
    return {
      codeConstants,
      number: v.number, state: v.state, baseRefName: v.baseRefName, changedFiles: v.changedFiles, isDraft: v.isDraft, mergeable: v.mergeable, body: v.body, behindBy,
      files,
      reviews: (v.reviews ?? []).map((r) => ({ author: r.author?.login, state: r.state })),
      checks: (v.statusCheckRollup ?? []).map((c) => ({ name: c.name ?? c.context, conclusion: c.conclusion || c.state })),
      unresolvedThreads,
    };
  } catch (e) { fetchPr.lastError = String(e?.stderr || e?.message || e).trim().split("\n")[0].slice(0, 200); return null; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const i = process.argv.indexOf("--repo");
  const repo = i > 0 ? process.argv[i + 1] : "cknowlesbadluck/Conduit";
  const nums = process.argv.slice(2).filter((a, k, all) => /^\d+$/.test(a) && all[k - 1] !== "--repo").map(Number);
  if (nums.length === 0) { console.error("usage: merge-readiness.mjs <pr> [<pr> ...] [--repo owner/name] [--json]"); process.exit(2); }
  const out = nums.map((n) => { const pr = fetchPr(repo, n); return { number: n, ...(pr ? evaluate(pr) : { ready: false, blockers: [`fetch_failed${fetchPr.lastError ? `: ${fetchPr.lastError}` : ""}`] }) }; });
  if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 2));
  else for (const r of out) console.log(`#${r.number} ${r.ready ? "READY" : "BLOCKED"}${r.blockers.length ? " — " + r.blockers.join(", ") : ""}`);
  process.exitCode = out.every((r) => r.ready) ? 0 : 1;
}
