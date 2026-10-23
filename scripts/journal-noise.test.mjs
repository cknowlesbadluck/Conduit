import test from "node:test";
import assert from "node:assert/strict";
import { isJournalPath, isJournalOnly, findJournalNoise } from "./journal-noise.mjs";

test("isJournalPath matches only journal files", () => {
  assert.equal(isJournalPath(".jules/bolt.md"), true);
  assert.equal(isJournalPath(".jules/journal/2026-10-23.md"), true);
  assert.equal(isJournalPath(".jules/bolt.ts"), false);
  assert.equal(isJournalPath("src/.jules/bolt.md"), false);
  assert.equal(isJournalPath("README.md"), false);
  assert.equal(isJournalPath(undefined), false);
});

test("isJournalOnly requires every file to be a journal file", () => {
  assert.equal(isJournalOnly([{ path: ".jules/bolt.md" }]), true);
  assert.equal(isJournalOnly([".jules/bolt.md", ".jules/palette.md"]), true);
  assert.equal(isJournalOnly([{ path: ".jules/bolt.md" }, { path: "src/store.ts" }]), false);
  assert.equal(isJournalOnly([]), false);
  assert.equal(isJournalOnly(null), false);
});

test("findJournalNoise returns only journal-only PRs", () => {
  const prs = [
    { number: 1, title: "journal", author: { login: "google-labs-jules" }, files: [{ path: ".jules/bolt.md" }] },
    { number: 2, title: "real fix", author: { login: "x" }, files: [{ path: ".jules/bolt.md" }, { path: "src/a.ts" }] },
    { number: 3, title: "no author", files: [{ path: ".jules/bolt.md" }] },
  ];
  assert.deepEqual(findJournalNoise(prs), [
    { number: 1, title: "journal", author: "google-labs-jules" },
    { number: 3, title: "no author", author: "unknown" },
  ]);
});
