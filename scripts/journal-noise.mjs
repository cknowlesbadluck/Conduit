#!/usr/bin/env node
// Flags open PRs whose changed files are ONLY agent journal files (e.g. .jules/*.md).
// Read-only: lists candidates, never closes anything. Usage: node scripts/journal-noise.mjs [owner/repo]
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const JOURNAL_PATTERNS = [/^\.jules\/[^/]+\.md$/, /^\.jules\/journal\//, /^\.bolt\/[^/]+\.md$/];

export function isJournalPath(path) {
  return typeof path === "string" && JOURNAL_PATTERNS.some((re) => re.test(path));
}

export function isJournalOnly(files) {
  return Array.isArray(files) && files.length > 0 && files.every((f) => isJournalPath(f?.path ?? f));
}

export function findJournalNoise(prs) {
  return prs.filter((pr) => isJournalOnly(pr.files)).map((pr) => ({ number: pr.number, title: pr.title, author: pr.author?.login ?? "unknown" }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = ["pr", "list", "--state", "open", "--limit", "200", "--json", "number,title,author,files"];
  if (process.argv[2]) args.push("-R", process.argv[2]);
  const noise = findJournalNoise(JSON.parse(execFileSync("gh", args, { encoding: "utf8" })));
  for (const n of noise) console.log(`#${n.number}\t${n.author}\t${n.title}`);
  console.error(`${noise.length} journal-only PR(s)`);
}
