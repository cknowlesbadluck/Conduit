import test from "node:test";
import assert from "node:assert/strict";
import { errorEnvelope, errorResult } from "./errors.js";

test("structured MCP errors expose stable code and message", () => {
  assert.deepEqual(errorEnvelope("task_not_found"), {
    error: { code: "task_not_found", message: "Task not found" },
  });
});

test("structured MCP error results are MCP errors with JSON envelope and structuredContent", () => {
  const result = errorResult("agent_identity_not_bound", { agentId: "agent-a" });
  assert.equal(result.isError, true);
  assert.equal(result.content[0].type, "text");
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.error.code, "agent_identity_not_bound");
  assert.match(parsed.error.message, /Register this agent first/);
  assert.deepEqual(parsed.error.details, { agentId: "agent-a" });
  assert.deepEqual(result.structuredContent, parsed);
});
