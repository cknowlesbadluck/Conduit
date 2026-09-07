import test from "node:test";
import assert from "node:assert/strict";
import { errorEnvelope, errorResult } from "./mcp.js";

test("structured MCP errors expose stable code and message", () => {
  assert.deepEqual(errorEnvelope("task_not_found"), {
    error: { code: "task_not_found", message: "Task not found" },
  });
});

test("structured MCP error results are MCP errors with JSON envelope", () => {
  const result = errorResult("agent_identity_not_bound", { agentId: "agent-a" });
  assert.equal(result.isError, true);
  assert.equal(result.content[0].type, "text");
  assert.deepEqual(JSON.parse(result.content[0].text), {
    error: {
      code: "agent_identity_not_bound",
      message: "Agent identity is not bound to the authenticated actor",
      details: { agentId: "agent-a" },
    },
  });
});
