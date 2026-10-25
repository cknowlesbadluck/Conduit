#!/usr/bin/env node
// Read-only PR-entropy trend: builds a JSON snapshot (per-repo open counts, age buckets,
// close candidates) from pr-hygiene summaries and a markdown delta vs the previous snapshot.
// Never mutates GitHub; only reads via `gh pr list` (through pr-hygiene fetchOpenPrs).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { summarizeRepo, fetchOpenPrs } from "./pr-hygiene.mjs";

export const AGE_BUCKETS = [["0-1d", 0, 1], ["2-7d", 2, 7], ["8-30d", 8, 30], ["31d+", 31, Infinity]];

export function ageBuckets(rows) {
  const out = Object.fromEntries(AGE_BUCKETS.map(([k]) => [k, 0]));
  for (const r of rows ?? []) {
    const d = Number.isFinite(r?.ageDays) ? r.ageDays : 0;
    const hit = AGE_BUCKETS.find(([, lo, hi]) => d >= lo && d <= hi);
    if (hit) out[hit[0]] += 1;
  }
  return out;
}

/** summaries: { repo: summarizeRepo(...) | null } -> snapshot (rows dropped to keep it small). */
export function buildSnapshot(summaries, at = new Date().toISOString()) {
  const repos = {};
  for (const [repo, s] of Object.entries(summaries ?? {})) {
    repos[repo] = s ? {
      open: s.open, drafts: s.drafts, docsOnly: s.docsOnly, conflicting: s.conflicting, ciRed: s.ciRed,
      changesRequested: s.changesRequested, oldestDays: s.oldestDays, ageBuckets: ageBuckets(s.rows),
      closeCandidates: s.closeCandidates.map((c) => c.number),
    } : null;
  }
  return { schema: "pr-entropy-snapshot/v1", at, repos };
}

const sign = (n) => (n > 0 ? `+${n}` : String(n));

export function diffSnapshots(prev, cur) {
  const out = {};
  for (const [repo, c] of Object.entries(cur?.repos ?? {})) {
    const p = prev?.repos?.[repo];
    if (!c) { out[repo] = { status: "unavailable" }; continue; }
    if (!p) { out[repo] = { status: "new", open: c.open }; continue; }
    const pc = new Set(p.closeCandidates), cc = new Set(c.closeCandidates);
    out[repo] = {
      status: "compared", openDelta: c.open - p.open, conflictingDelta: c.conflicting - p.conflicting, ciRedDelta: c.ciRed - p.ciRed,
      newCandidates: [...cc].filter((n) => !pc.has(n)), clearedCandidates: [...pc].filter((n) => !cc.has(n)),
    };
  }
  return out;
}

export function trendMarkdown(prev, cur) {
  const d = diffSnapshots(prev, cur);
  const lines = [`# PR entropy snapshot ${cur.at}`, prev ? `Compared with ${prev.at}.` : "No previous snapshot (baseline).", "",
    "| Repo | Open | Δ open | 0-1d | 2-7d | 8-30d | 31d+ | Conflicting (Δ) | CI red (Δ) | Close candidates | New / cleared |",
    "|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const [repo, c] of Object.entries(cur.repos)) {
    const name = String(repo).replace(/[^A-Za-z0-9._-]/g, "");
    if (!c) { lines.push(`| ${name} | unavailable | | | | | | | | | |`); continue; }
    const x = d[repo], b = c.ageBuckets, cmp = x.status === "compared";
    lines.push(`| ${name} | ${c.open} | ${cmp ? sign(x.openDelta) : "n/a"} | ${b["0-1d"]} | ${b["2-7d"]} | ${b["8-30d"]} | ${b["31d+"]} | ${c.conflicting} (${cmp ? sign(x.conflictingDelta) : "n/a"}) | ${c.ciRed} (${cmp ? sign(x.ciRedDelta) : "n/a"}) | ${c.closeCandidates.map((n) => `#${n}`).join(" ") || "-"} | ${cmp ? `${x.newCandidates.map((n) => `+#${n}`).join(" ") || "-"} / ${x.clearedCandidates.map((n) => `-#${n}`).join(" ") || "-"}` : "n/a"} |`);
  }
  return lines.join("\n");
}

/** Latest snapshot file (lexical ISO-name order) in dir, or null. */
export function latestSnapshot(dir) {
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).filter((n) => /^pr-entropy-.*\.json$/.test(n)).sort().pop();
  if (!f) return null;
  try { return JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { return null; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (k, dflt) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : dflt; };
  const repos = (arg("--repos", "QuicksilverV1,Conduit,Resonance")).split(",");
  const dir = arg("--dir", ".entropy");
  const summaries = {};
  for (const repo of repos) summaries[repo] = summarizeRepo(fetchOpenPrs(repo));
  const prev = latestSnapshot(dir);
  const cur = buildSnapshot(summaries);
  mkdirSync(dir, { recursive: true });
  const stamp = cur.at.replace(/[:.]/g, "-");
  writeFileSync(join(dir, `pr-entropy-${stamp}.json`), JSON.stringify(cur, null, 2) + "\n");
  const md = trendMarkdown(prev, cur);
  writeFileSync(join(dir, `pr-entropy-${stamp}.md`), md + "\n");
  console.log(md);
}
