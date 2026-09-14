import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "./escape.js";

describe("escapeHtml", () => {
  it("escapes markup-sensitive characters", () => {
    assert.equal(escapeHtml(`<script>alert("x")</script>`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    assert.equal(escapeHtml("a&b"), "a&amp;b");
    assert.equal(escapeHtml("it's"), "it&#39;s");
  });

  it("stringifies nullish as empty", () => {
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
  });
});
