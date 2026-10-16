import test from "node:test";
import assert from "node:assert/strict";
import { redactUrl } from "./url-redact.js";
import { runDiagnostics } from "./diagnostics.js";

test("redactUrl strips userinfo and token-like query params", () => {
  const out = redactUrl("https://alice:hunter2@conduit.example.com/mcp?access_token=abc&api_key=k&region=us");
  assert.equal(out, "https://conduit.example.com/mcp?region=us");
  assert.ok(!out.includes("hunter2") && !out.includes("alice") && !out.includes("abc"));
});

test("redactUrl never reflects unparseable input", () => {
  assert.equal(redactUrl("not a url with secret"), "[invalid-url]");
  assert.equal(redactUrl(undefined), "");
});

test("diagnostics never echoes credentials embedded in PUBLIC_URL", async () => {
  const previous = process.env.PUBLIC_URL;
  process.env.PUBLIC_URL = "http://user:s3cretPass@127.0.0.1:1/?token=leak";
  try {
    const result = await runDiagnostics(undefined, "http://127.0.0.1:1");
    const body = JSON.stringify(result);
    assert.ok(!body.includes("s3cretPass"), body);
    assert.ok(!body.includes("user:"), body);
    assert.ok(!body.includes("leak"), body);
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_URL; else process.env.PUBLIC_URL = previous;
  }
});
