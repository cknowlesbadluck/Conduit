import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registeredTools, documentedTools, toolSurfaceDrift } from "./tool-surface.mjs";

test("docs/MCP-TOOLS.md matches the registered MCP tool surface", () => {
  const doc = documentedTools(readFileSync(new URL("../docs/MCP-TOOLS.md", import.meta.url), "utf8"));
  const d = toolSurfaceDrift(doc, registeredTools());
  assert.deepEqual({ undocumented: d.undocumented, missing: d.missing }, { undocumented: [], missing: [] });
  assert.ok(d.count >= 30);
});

test("drift detection reports both directions", () => {
  const d = toolSurfaceDrift(["a", "b"], ["b", "c"]);
  assert.equal(d.ok, false);
  assert.deepEqual(d.undocumented, ["c"]);
  assert.deepEqual(d.missing, ["a"]);
  assert.deepEqual(documentedTools("- `task_claim` x\n* `grant_create`\ntext `nope`"), ["grant_create", "task_claim"]);
});

test("test-file registrations are excluded", () => {
  const t = registeredTools();
  assert.ok(!t.includes("t") && !t.includes("tool") && !t.includes("count"));
  assert.ok(t.includes("mcp_bridge_call"));
});
