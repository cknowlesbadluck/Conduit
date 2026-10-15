import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createConduitServer } from "./mcp.js";

/**
 * Pinned MCP tool surface (name + behaviour annotations). Clients plan around these hints
 * (read-only tools are auto-approved, destructive/open-world ones prompt), so any change must
 * be deliberate: update src/tool-surface.snapshot.json in the same PR and say why.
 */
type Hints = { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };

function liveSurface(): Record<string, Hints> {
  const tools = (createConduitServer() as unknown as { _registeredTools: Record<string, { annotations?: Partial<Hints> }> })._registeredTools;
  const out: Record<string, Hints> = {};
  for (const name of Object.keys(tools).sort()) {
    const a = tools[name].annotations ?? {};
    out[name] = { readOnlyHint: !!a.readOnlyHint, destructiveHint: !!a.destructiveHint, idempotentHint: !!a.idempotentHint, openWorldHint: !!a.openWorldHint };
  }
  return out;
}

test("MCP tool surface matches the pinned snapshot (names + annotations)", async () => {
  const pinned = JSON.parse(await readFile(new URL("../src/tool-surface.snapshot.json", import.meta.url), "utf8"));
  assert.deepEqual(liveSurface(), pinned, "tool surface changed: update src/tool-surface.snapshot.json deliberately");
});

test("annotation invariants: read-only is never destructive; open-world is only the outbound bridges", () => {
  const surface = liveSurface();
  for (const [name, h] of Object.entries(surface)) {
    if (h.readOnlyHint) assert.equal(h.destructiveHint, false, `${name}: readOnly and destructive`);
    if (h.openWorldHint) assert.equal(h.readOnlyHint, false, `${name}: open-world must not claim read-only`);
  }
  assert.deepEqual(Object.keys(surface).filter((n) => surface[n].openWorldHint).sort(), ["integration_call", "mcp_bridge_call"]);
});
