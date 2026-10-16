import test from "node:test";
import assert from "node:assert/strict";
import { runDiagnostics } from "./diagnostics.js";

const SECRETS = {
  CONDUIT_TOKEN: "conduit-secret-token-value-123456",
  GITHUB_TOKEN: "ghp_" + "z".repeat(36),
  DATABASE_URL: "postgres://user:db-password-value@db.example/conduit",
};

async function withEnvAndFetch(fetchImpl: typeof fetch, fn: () => Promise<void>) {
  const savedEnv = Object.fromEntries(Object.keys(SECRETS).map((k) => [k, process.env[k]]));
  const savedFetch = globalThis.fetch;
  Object.assign(process.env, SECRETS);
  globalThis.fetch = fetchImpl;
  try { await fn(); } finally {
    globalThis.fetch = savedFetch;
    for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

function assertNoSecrets(output: unknown) {
  const text = JSON.stringify(output);
  for (const [name, value] of Object.entries(SECRETS)) assert.ok(!text.includes(value), `${name} leaked into diagnostics`);
  assert.ok(!text.includes("db-password-value"));
}

test("diagnostics output never echoes credential env values, even when responses contain them", async () => {
  const echoing = (async () => new Response(JSON.stringify({ scopes_supported: ["conduit.read"], echo: SECRETS }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  await withEnvAndFetch(echoing, async () => assertNoSecrets(await runDiagnostics(undefined, "http://localhost:3999")));
});

test("diagnostics output never echoes credential env values on fetch failure", async () => {
  const failing = (async () => { throw new Error("connect ECONNREFUSED"); }) as typeof fetch;
  await withEnvAndFetch(failing, async () => {
    const result = await runDiagnostics(undefined, "http://localhost:3999");
    assertNoSecrets(result);
    assert.equal(result.checks.health.ok, false);
  });
});
