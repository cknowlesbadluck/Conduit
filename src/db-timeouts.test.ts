import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AUTH_DISCOVERY_TIMEOUT_MS, DATABASE_CONNECT_TIMEOUT_MS } from "./db-timeouts.js";

test("database and discovery timeouts are finite and wired into every pool", async () => {
  assert.ok(DATABASE_CONNECT_TIMEOUT_MS >= 1000 && Number.isFinite(DATABASE_CONNECT_TIMEOUT_MS));
  assert.ok(AUTH_DISCOVERY_TIMEOUT_MS > 0);
  // One shared work pool carries the connect timeout; the stores must use it, not their own pools.
  const shared = await readFile(new URL("../src/db-pool.ts", import.meta.url), "utf8");
  assert.match(shared, /connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS/);
  for (const file of ["store", "capability-store", "binding-subjects"]) {
    const src = await readFile(new URL(`../src/${file}.ts`, import.meta.url), "utf8");
    assert.match(src, /getSharedPool\(\)/, file);
    assert.doesNotMatch(src, /new (pg\.)?Pool\(/, `${file} must not open its own pool`);
  }
  const auth = await readFile(new URL("../src/auth.ts", import.meta.url), "utf8");
  assert.match(auth, /AbortSignal\.timeout\(AUTH_DISCOVERY_TIMEOUT_MS\)/);
});

test("pg actually honours the connect timeout against an unreachable host", async () => {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ host: "10.255.255.1", port: 5432, user: "x", database: "x", connectionTimeoutMillis: 300 });
  const started = Date.now();
  await assert.rejects(() => pool.query("SELECT 1"));
  assert.ok(Date.now() - started < 5000);
  await pool.end();
});
