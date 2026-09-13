import test from "node:test";
import assert from "node:assert/strict";
import { enforceExternalCapability } from "./external-policy.js";

process.env.CONDUIT_TEST_MEMORY = "true";
process.env.CONDUIT_CAPABILITIES_REQUIRED = "true";

test("external policy denies an ungranted integration call", async () => {
  await assert.rejects(
    () => enforceExternalCapability({ agentId: "agent_1", provider: "github", method: "GET", path: "/repos/other/repo" }),
    /capability_denied/,
  );
});
