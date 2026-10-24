#!/usr/bin/env node
/**
 * Read-only MCP capability discovery (static): compares the tools registered in src/
 * (registerTool("name", ...)) with the documented list in docs/MCP-TOOLS.md.
 * No network, no env vars, no writes. `node scripts/tool-surface.mjs` exits 1 on drift.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Remove line and block comments while keeping string and template literals intact. */
export function stripComments(src) {
  let out = "", i = 0, q = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (q) {
      out += c;
      if (c === "\\") { out += n ?? ""; i += 2; continue; }
      if (c === q) q = null;
      i++;
    } else if (c === '"' || c === "'" || c === "`") { q = c; out += c; i++; }
    else if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; }
    else if (c === "/" && n === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; out += " "; }
    else { out += c; i++; }
  }
  return out;
}

/** Tool names in live registerTool("name"|'name', ...) calls (comments ignored). */
export function toolNamesIn(source) {
  return [...stripComments(source).matchAll(/registerTool\(\s*(["'])([a-z][a-z0-9_]*)\1/g)].map((m) => m[2]);
}

/** Tool names registered by non-test TypeScript sources. */
export function registeredTools(srcDir = join(root, "src")) {
  const names = new Set();
  for (const f of readdirSync(srcDir)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    for (const n of toolNamesIn(readFileSync(join(srcDir, f), "utf8"))) names.add(n);
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

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = toolSurfaceDrift(documentedTools(readFileSync(join(root, "docs", "MCP-TOOLS.md"), "utf8")), registeredTools());
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
