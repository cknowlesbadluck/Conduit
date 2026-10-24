import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registeredTools, documentedTools, toolSurfaceDrift, toolNamesIn } from "./tool-surface.mjs";

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

test("commented-out registrations are ignored; single quotes are found", () => {
  const src = [
    '// server.registerTool("task_claim", {})',
    '/* server.registerTool("old_tool", {}) */',
    "server.registerTool('single_q', {});",
    'server.registerTool("live_tool", { description: "see // not a comment" });',
    'const url = "http://x/*y";',
    'server.registerTool("after_url", {});',
  ].join("\n");
  assert.deepEqual(toolNamesIn(src).sort(), ["after_url", "live_tool", "single_q"]);
});
