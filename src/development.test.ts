import test from "node:test";
import assert from "node:assert/strict";
import { getDevelopmentContext } from "./development.js";

test("development context is explicitly scoped to Resonance", () => {
  const context = getDevelopmentContext();
  assert.equal(context.status, "active");
  assert.equal(context.primaryProject.name, "Resonance");
  assert.equal(context.primaryProject.repository, "cknowlesbadluck/Resonance");
  assert.match(context.purpose, /build Resonance/i);
  assert.match(context.conduitBoundary, /separate development bridge/i);
  assert.ok(context.currentObjectives.length >= 4);
  assert.ok(context.constraints.length >= 3);
});
