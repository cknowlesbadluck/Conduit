import test from "node:test";
import assert from "node:assert/strict";
import { assessTaskConvention } from "./mcp.js";

test("assessTaskConvention ignores ordinary tasks", () => {
  assert.equal(assessTaskConvention("Fix typo in README"), undefined);
  assert.equal(assessTaskConvention("Implement feature X", "plain description"), undefined);
});

test("assessTaskConvention warns on GATE without DEPENDS/CRITERIA", () => {
  const w = assessTaskConvention("GATE: production lock", "do the thing");
  assert.ok(w && w.includes("convention_warning"));
});

test("assessTaskConvention warns on MASTER ROADMAP without convention lines", () => {
  const w = assessTaskConvention("MASTER ROADMAP: Quicksilver", "audit and sequence");
  assert.ok(w && w.includes("convention_warning"));
});

test("assessTaskConvention accepts complete GATE tasks", () => {
  const desc = "DEPENDS: resource_abc\nGATE-CRITERIA: diagnostics green\nOWNER-ROLE: ops";
  assert.equal(assessTaskConvention("GATE: production lock", desc), undefined);
});

test("assessTaskConvention requires both DEPENDS and GATE-CRITERIA", () => {
  assert.ok(assessTaskConvention("GATE: x", "DEPENDS: resource_1"));
  assert.ok(assessTaskConvention("GATE: x", "GATE-CRITERIA: done"));
});
