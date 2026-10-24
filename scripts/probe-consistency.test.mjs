import test from "node:test";
import assert from "node:assert/strict";
import { crossPlaneConsistency } from "./portfolio-probe.mjs";

const targets = [
  { name: "a", expect: { contractRevision: "rev-a" } },
  { name: "b", parity: { contractRevision: "rev-b" } },
  { name: "c" },
];

test("consistent when every pinned plane reports its expected revision", () => {
  const r = crossPlaneConsistency([
    { name: "a", outcome: "ready", version: "0.8.0", contractRevision: "rev-a" },
    { name: "b", outcome: "ready", contractRevision: "rev-b" },
    { name: "c", outcome: "ready", contractRevision: "whatever" },
  ], targets);
  assert.equal(r.consistent, true);
  assert.deepEqual(r.mismatched, []);
  assert.equal(r.planes.find((p) => p.name === "c").match, null);
  assert.equal(r.planes[0].version, "0.8.0");
});

test("flags a plane whose revision drifted or is absent", () => {
  const r = crossPlaneConsistency([
    { name: "a", outcome: "contract_changed", contractRevision: "rev-x" },
    { name: "b", outcome: "ready" },
  ], targets);
  assert.equal(r.consistent, false);
  assert.deepEqual(r.mismatched, ["a", "b"]);
});

test("ignores planes that are not ready (unreachable/not_ready)", () => {
  const r = crossPlaneConsistency([{ name: "a", outcome: "unreachable" }, { name: "b", outcome: "not_ready" }], targets);
  assert.deepEqual(r, { consistent: true, mismatched: [], planes: [] });
});
