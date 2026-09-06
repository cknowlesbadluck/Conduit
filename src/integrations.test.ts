import test from "node:test";
import assert from "node:assert/strict";
import { callIntegration, listIntegrations } from "./integrations.js";

test("integration metadata reports configuration without exposing credentials", () => {
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "super-secret-test-token";
  try {
    const github = listIntegrations().find((item) => item.provider === "github")!;
    assert.equal(github.configured, true);
    assert.equal(JSON.stringify(github).includes("super-secret-test-token"), false);
    assert.equal("token" in github, false);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous;
  }
});

test("unconfigured integrations fail before network access", async () => {
  const previous = process.env.RENDER_API_KEY;
  delete process.env.RENDER_API_KEY;
  try {
    await assert.rejects(() => callIntegration({ provider: "render", method: "GET", path: "/v1/owners" }), /integration_not_configured:render/);
  } finally {
    if (previous !== undefined) process.env.RENDER_API_KEY = previous;
  }
});

test("integration paths reject absolute URLs, traversal, and protocol-like paths", async () => {
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-token";
  try {
    await assert.rejects(() => callIntegration({ provider: "github", method: "GET", path: "https://evil.example" }), /integration_path_must_start_with_slash/);
    await assert.rejects(() => callIntegration({ provider: "github", method: "GET", path: "//evil.example" }), /integration_path_must_be_relative/);
    await assert.rejects(() => callIntegration({ provider: "github", method: "GET", path: "/../secret" }), /integration_path_invalid/);
    await assert.rejects(() => callIntegration({ provider: "github", method: "GET", path: "/api\\secret" }), /integration_path_invalid/);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous;
  }
});

test("integration calls enforce request and response limits and timeout", async () => {
  const previous = process.env.GITHUB_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.GITHUB_TOKEN = "test-token";
  try {
    globalThis.fetch = async () => new Response("x".repeat(1024 * 1024 + 1), { status: 200, headers: { "content-type": "text/plain" } });
    await assert.rejects(() => callIntegration({ provider: "github", method: "GET", path: "/rate_limit" }), /integration_response_too_large/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous;
  }
});

test("integration calls never return authorization response headers and use provider authentication", async () => {
  const previous = process.env.GITHUB_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.GITHUB_TOKEN = "test-token";
  let receivedHeaders: Headers | undefined;
  try {
    globalThis.fetch = async (_url, init) => {
      receivedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", authorization: "Bearer leaked" } });
    };
    const result = await callIntegration({ provider: "github", method: "GET", path: "/rate_limit" });
    assert.equal(receivedHeaders?.get("authorization"), "Bearer test-token");
    assert.equal(result.headers.authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous;
  }
});
