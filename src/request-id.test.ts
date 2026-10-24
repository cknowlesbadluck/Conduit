import test from "node:test";
import assert from "node:assert/strict";
import { resolveRequestId } from "./request-id.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("keeps a safe caller request id", () => {
  assert.equal(resolveRequestId("req-123_abc.def:9"), "req-123_abc.def:9");
});

test("replaces missing, oversized or unsafe request ids with a UUID", () => {
  for (const bad of [undefined, "", "x".repeat(81), "a b", "id\u0000x", "<script>", "fake\tlog line", "ok\u2028x"]) {
    assert.match(resolveRequestId(bad), UUID, JSON.stringify(bad));
  }
});
