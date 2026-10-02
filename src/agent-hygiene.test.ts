import assert from "node:assert/strict";
import test from "node:test";
import { classifyAgentIds } from "./agent-hygiene.js";

test("classifyAgentIds keeps the grok / grok-xai split visible and does not mutate", () => {
  const ids = ["chatgpt", "claude", "grok", "grok-xai", "gemini-spark"];
  const result = classifyAgentIds(ids);
  assert.deepEqual(result.clusters, [["grok", "grok-xai"]]);
  assert.equal(result.advisory, "prefix_splits_are_advisory_do_not_rebind");
  assert.deepEqual(ids, ["chatgpt", "claude", "grok", "grok-xai", "gemini-spark"]);
});

test("classifyAgentIds is quiet when every prefix is unique", () => {
  const result = classifyAgentIds(["chatgpt", "claude", "grok"]);
  assert.deepEqual(result.clusters, []);
  assert.equal(result.advisory, "no_prefix_splits");
});
