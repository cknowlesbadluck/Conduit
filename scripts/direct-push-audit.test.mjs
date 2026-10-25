import { test } from "node:test";
import assert from "node:assert/strict";
import { directPushes, directPushMarkdown, fetchCommits, isDocsPath } from "./direct-push-audit.mjs";

const commits = [
  { sha: "e513530aaaa", date: "2026-10-25T18:02:36Z", author: "A", message: "docs: refresh\n\nbody", prs: [], files: ["docs/AUDIT.md"] },
  { sha: "abc1234bbbb", date: "2026-10-25T18:10:00Z", author: "A", message: "fix: thing", prs: [], files: ["src/x.ts", "README.md"] },
  { sha: "fff0000cccc", date: "2026-10-25T18:20:00Z", author: "A", message: "merged", prs: [12], files: ["src/y.ts"] },
  { sha: "0000000dddd", date: "2026-10-25T18:30:00Z", author: "A", message: "huge", prs: [], files: null },
];

test("isDocsPath", () => {
  assert.ok(isDocsPath("docs/a.txt")); assert.ok(isDocsPath("README.md")); assert.ok(!isDocsPath("src/docs.ts"));
});

test("directPushes keeps only no-PR commits and classifies them", () => {
  assert.deepEqual(directPushes(commits).map((x) => [x.sha, x.kind, x.subject]), [["e513530", "docs", "docs: refresh"], ["abc1234", "code", "fix: thing"], ["0000000", "unknown", "huge"]]);
  assert.deepEqual(directPushes([{ sha: "1", prs: null }]), []); // unknown PR association is not counted here; CLI marks the repo unavailable
});

test("markdown flags code pushes and unavailable repos", () => {
  const md = directPushMarkdown({ QS: directPushes(commits), Conduit: [], Resonance: null }, "2026-10-25T14:05:00Z");
  assert.match(md, /\| QS \| 3 \| 1 \| \*\*1\*\* \| 1 \| e513530 abc1234! 0000000 \|/);
  assert.match(md, /\| Conduit \| 0 \| 0 \| 0 \| 0 \| - \|/);
  assert.match(md, /\| Resonance \| unavailable/);
});

test("fetchCommits is GET-only, maps PRs/files, and fails closed", () => {
  const calls = [];
  const run = (a) => { calls.push(a);
    if (a[1].includes("/commits?")) return [{ sha: "s1", commit: { author: { name: "A", date: "d" }, message: "m" } }];
    if (a[1].endsWith("/pulls")) return [{ number: 7 }];
    return { files: [{ filename: "docs/a.md" }] }; };
  assert.deepEqual(fetchCommits("o/r", "2026-10-25T00:00:00Z", run), [{ sha: "s1", date: "d", author: "A", message: "m", prs: [7], files: ["docs/a.md"] }]);
  assert.ok(calls.every((a) => a[0] === "api" && !a.includes("-X") && !a.includes("--method")));
  assert.equal(fetchCommits("o/r", "x", () => { throw new Error("boom"); }), null);
  assert.equal(fetchCommits("o/r", "x", () => Array.from({ length: 100 }, () => ({ sha: "z" }))), null);
});
