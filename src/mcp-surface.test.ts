import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const coreTools = [
  "agent_identity", "development_context", "agent_register",
  "project_create", "project_get", "project_archive", "resource_register", "resource_archive",
  "integrations_list", "integration_call", "mcp_bridge_call", "task_create", "task_get",
  "task_block", "task_release", "task_claim", "task_complete", "task_handoff", "contact_add",
  "tool_register", "contact_archive", "tool_archive", "activity_prune",
];
const policyTools = ["grant_create", "grant_revoke", "grants_list", "conduit_diagnostics"];
const paginatedTools = ["agents_list", "projects_list", "resources_list", "task_list", "contacts_list", "tools_list", "activity_list", "conduit_context"];

test("public MCP tool surface remains explicit and complete", async () => {
  const source = await readFile(new URL("../src/mcp.ts", import.meta.url), "utf8");
  const policySource = await readFile(new URL("../src/grant-tools.ts", import.meta.url), "utf8");
  const paginationSource = await readFile(new URL("../src/pagination-tools.ts", import.meta.url), "utf8");
  for (const name of coreTools) assert.match(source, new RegExp(`registerTool\\("${name}"`), name);
  for (const name of policyTools) assert.match(policySource, new RegExp(`registerTool\\("${name}"`), name);
  for (const name of paginatedTools) assert.match(paginationSource, new RegExp(`registerTool\\("${name}"`), name);
  assert.match(source, /registerPaginationTools\(server, authConfig\)/);
  assert.doesNotMatch(policySource, /registerPaginationTools/);
  assert.match(source, /new McpServer\(\{ name: SERVICE_NAME, version: VERSION/);
  assert.doesNotMatch(source, /version: ["']0\.6\.0["']/);
  assert.match(source, /errorResult\(error, details\)/);
  assert.match(source, /idempotentHint: true/);
  assert.match(source, /openWorldHint: true/);
  assert.match(source, /structuredContent/);
});
