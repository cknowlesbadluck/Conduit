import test from "node:test";
import assert from "node:assert/strict";
import { entropyMarkdown, prEntropy } from "./portfolio-probe.mjs";

test("entropyMarkdown renders header + one row per repo", () => {
  const now = Date.parse("2026-10-24T01:00:00Z");
  const prs = [
    { number: 1, created_at: "2026-10-23T12:00:00Z", base: { ref: "main" }, head: { ref: "a" } },
    { number: 2, created_at: "2026-09-01T00:00:00Z", draft: true, base: { ref: "a" }, head: { ref: "b" } },
  ];
  const md = entropyMarkdown({ Conduit: prEntropy(prs, now) }).split("\n");
  assert.equal(md.length, 3);
  assert.match(md[0], /^\| Repo \| Open/);
  assert.equal(md[2], "| Conduit | 2 | 1 | 0 | 0 | 1 | 53 | 1 | 1 | 1 |");
});

test("entropyMarkdown fails closed on null repos and sanitizes names", () => {
  const md = entropyMarkdown({ "Res|onance<x>": null }).split("\n");
  assert.equal(md[2], "| Resonancex | unavailable | | | | | | | | |");
  assert.equal(entropyMarkdown(undefined).split("\n").length, 2);
});

test("entropyMarkdown never echoes non-numeric cell values", () => {
  const md = entropyMarkdown({ R: { open: "<script>", ageBuckets: {}, oldestDays: null } });
  assert.doesNotMatch(md, /script/);
});
