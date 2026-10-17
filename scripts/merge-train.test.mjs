import test from "node:test";
import assert from "node:assert/strict";
import { analyze, isSensitive, toMarkdown } from "./merge-train.mjs";

const green = [{ name: "verify", status: "completed", conclusion: "success" }, { name: "Workers Builds: conduit", status: "completed", conclusion: "failure" }];
const pr = (number, files, extra = {}) => ({ number, title: `pr ${number}`, draft: false, mergeable: "MERGEABLE", checks: green, files: files.map((f) => (typeof f === "string" ? { filename: f, status: "modified" } : f)), ...extra });

test("flags two PRs adding the same new file (the #155/#251 db-pool case)", () => {
  const r = analyze([pr(155, [{ filename: "src/db-pool.ts", status: "added" }, "src/store.ts"]), pr(251, [{ filename: "src/db-pool.ts", status: "added" }, "src/status.ts"])]);
  assert.deepEqual(r.duplicateAdds, [{ file: "src/db-pool.ts", prs: [155, 251] }]);
});

test("ignores the known-red Workers check but not real failures", () => {
  const red = [{ name: "verify", status: "completed", conclusion: "failure" }];
  const r = analyze([pr(1, ["docs/a.md"]), pr(2, ["docs/b.md"], { checks: red })]);
  assert.equal(r.rows[0].ci, "green");
  assert.equal(r.rows[1].ci, "red");
  assert.deepEqual(r.mergeOrder, [1]);
});

test("auth/grant/bridge source changes are owner-gated; their tests alone are not", () => {
  assert.equal(isSensitive([{ filename: "src/grant-tools.ts" }]), true);
  assert.equal(isSensitive([{ filename: "src/auth.verifier.test.ts" }]), false);
  const r = analyze([pr(3, ["src/auth.ts"]), pr(4, ["README.md"], { title: "DRAFT KEEP RED: x" }), pr(5, ["README.md"], { mergeable: "CONFLICTING" })]);
  assert.deepEqual(r.mergeOrder, []);
});

test("detects heavy overlap and hotspots, orders candidates by conflicts then size", () => {
  const r = analyze([pr(10, ["a.ts", "b.ts", "c.ts"]), pr(11, ["a.ts", "b.ts", "c.ts"]), pr(12, ["a.ts", "z.ts"]), pr(13, ["y.ts"])]);
  assert.deepEqual(r.overlaps, [{ prs: [10, 11], score: 1 }]);
  assert.deepEqual(r.hotspots[0], { file: "a.ts", prs: [10, 11, 12] });
  assert.deepEqual(r.mergeOrder, [13, 12, 10, 11]);
  assert.match(toMarkdown("o/r", r), /#10 ~ #11/);
});
