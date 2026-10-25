import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ageBuckets, buildSnapshot, diffSnapshots, trendMarkdown, latestSnapshot } from "./pr-entropy-trend.mjs";

const prev = JSON.parse(readFileSync(new URL("../test/fixtures/entropy/prev.json", import.meta.url), "utf8"));
const summary = (open, conflicting, ciRed, cands, ages) => ({ open, drafts: 0, docsOnly: 0, conflicting, ciRed, changesRequested: 0, oldestDays: Math.max(...ages),
  closeCandidates: cands.map((number) => ({ number, reasons: [], title: "" })), rows: ages.map((ageDays) => ({ ageDays })) });

test("ageBuckets: boundaries and missing ages", () => {
  assert.deepEqual(ageBuckets([{ ageDays: 0 }, { ageDays: 1 }, { ageDays: 2 }, { ageDays: 7 }, { ageDays: 8 }, { ageDays: 30 }, { ageDays: 31 }, {}]),
    { "0-1d": 3, "2-7d": 2, "8-30d": 2, "31d+": 1 });
  assert.deepEqual(ageBuckets(null), { "0-1d": 0, "2-7d": 0, "8-30d": 0, "31d+": 0 });
});

test("buildSnapshot drops rows, keeps candidate numbers, preserves unavailable repos", () => {
  const s = buildSnapshot({ Conduit: summary(2, 1, 0, [9], [0, 40]), QuicksilverV1: null }, "2026-10-25T16:00:00.000Z");
  assert.equal(s.schema, "pr-entropy-snapshot/v1");
  assert.deepEqual(s.repos.Conduit.closeCandidates, [9]);
  assert.equal(s.repos.Conduit.rows, undefined);
  assert.equal(s.repos.QuicksilverV1, null);
});

test("diffSnapshots + trendMarkdown against fixture", () => {
  const cur = buildSnapshot({ Conduit: summary(15, 1, 1, [275, 330], [0, 3, 10, 45]), Resonance: summary(20, 2, 0, [], [1]), QuicksilverV1: null }, "2026-10-25T16:00:00.000Z");
  const d = diffSnapshots(prev, cur);
  assert.deepEqual(d.Conduit, { status: "compared", openDelta: -2, conflictingDelta: -2, ciRedDelta: 1, newCandidates: [330], clearedCandidates: [204] });
  assert.deepEqual(d.Resonance, { status: "new", open: 20 });
  assert.deepEqual(d.QuicksilverV1, { status: "unavailable" });
  const md = trendMarkdown(prev, cur);
  assert.match(md, /\| Conduit \| 15 \| -2 \| 1 \| 1 \| 1 \| 1 \| 1 \(-2\) \| 1 \(\+1\) \| #275 #330 \| \+#330 \/ -#204 \|/);
  assert.match(md, /\| QuicksilverV1 \| unavailable/);
  assert.match(trendMarkdown(null, cur), /baseline/);
});

test("latestSnapshot picks newest file and tolerates missing/corrupt", () => {
  const dir = mkdtempSync(join(tmpdir(), "entropy-"));
  assert.equal(latestSnapshot(join(dir, "nope")), null);
  writeFileSync(join(dir, "pr-entropy-2026-10-25T15-00-00-000Z.json"), JSON.stringify(prev));
  writeFileSync(join(dir, "pr-entropy-2026-10-25T16-00-00-000Z.json"), "{bad");
  assert.equal(latestSnapshot(dir), null);
  writeFileSync(join(dir, "pr-entropy-2026-10-25T16-00-00-000Z.json"), JSON.stringify({ ...prev, at: "x" }));
  assert.equal(latestSnapshot(dir).at, "x");
});
