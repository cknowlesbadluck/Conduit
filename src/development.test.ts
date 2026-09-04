import test from "node:test";
import assert from "node:assert/strict";
import { getDevelopmentContext } from "./development.js";

test("development context is project-agnostic", () => {
  const context = getDevelopmentContext();
  assert.equal(context.status, "active");
  assert.match(context.purpose, /coordinate AI agents/i);
  assert.match(context.scope, /project-agnostic/i);
  assert.ok(context.capabilities.length >= 5);
  assert.ok(context.constraints.length >= 4);
  assert.doesNotMatch(JSON.stringify(context), /Resonance/i);
});
