#!/usr/bin/env node
// Flags open PRs whose changed files are ONLY agent journal files (e.g. .jules/*.md).
// Read-only: lists candidates, never closes anything. Usage: node scripts/journal-noise.mjs [owner/repo]
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const JOURNAL_PATTERNS = [/^\.jules\/[^/]+\.md$/, /^\.jules\/journal\//, /^\.bolt\/[^/]+\.md$/];

export function isJournalPath(path) {
  return typeof path === "string" && JOURNAL_PATTERNS.some((re) => re.test(path));
}

// gh returns at most 100 files per PR; a list that long may be truncated, so never flag it.
export const FILE_LIST_CAP = 100;

export function isJournalOnly(files) {
  return Array.isArray(files) && files.length > 0 && files.length < FILE_LIST_CAP && files.every((f) => isJournalPath(f?.path ?? f));
}

export function findJournalNoise(prs) {
  return prs.filter((pr) => isJournalOnly(pr.files)).map((pr) => ({ number: pr.number, title: pr.title, author: pr.author?.login ?? "unknown" }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const LIMIT = 200;
  const args = ["pr", "list", "--state", "open", "--limit", String(LIMIT), "--json", "number,title,author,files"];
  if (process.argv[2]) args.push("-R", process.argv[2]);
  const prs = JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  const noise = findJournalNoise(prs);
  for (const n of noise) console.log(`#${n.number}\t${n.author}\t${n.title}`);
  const capped = prs.length >= LIMIT ? ` (scan capped at ${LIMIT} PRs; results may be incomplete)` : "";
  console.error(`${noise.length} journal-only PR(s) among ${prs.length} scanned${capped}`);
}
