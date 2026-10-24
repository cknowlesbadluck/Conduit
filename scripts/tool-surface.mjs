#!/usr/bin/env node
/**
 * Read-only MCP capability discovery (static): compares the tools registered in src/
 * (registerTool("name", ...)) with the documented list in docs/MCP-TOOLS.md.
 * No network, no env vars, no writes. `node scripts/tool-surface.mjs` exits 1 on drift.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Tool names registered by non-test TypeScript sources. */
export function registeredTools(srcDir = join(root, "src")) {
  const names = new Set();
  for (const f of readdirSync(srcDir)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    for (const m of readFileSync(join(srcDir, f), "utf8").matchAll(/registerTool\(\s*"([a-z][a-z0-9_]*)"/g)) names.add(m[1]);
  }
  return [...names].sort();
}

/** Tool names documented as "- `name`" bullets in the markdown file. */
export function documentedTools(markdown) {
  return [...markdown.matchAll(/^\s*[-*]\s+`([a-z][a-z0-9_]*)`/gm)].map((m) => m[1]).sort();
}

export function toolSurfaceDrift(documented, registered) {
  const d = new Set(documented), r = new Set(registered);
  const undocumented = registered.filter((n) => !d.has(n));
  const missing = documented.filter((n) => !r.has(n));
  return { ok: undocumented.length === 0 && missing.length === 0, undocumented, missing, count: registered.length };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const result = toolSurfaceDrift(documentedTools(readFileSync(join(root, "docs", "MCP-TOOLS.md"), "utf8")), registeredTools());
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
