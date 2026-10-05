import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { databaseSslOption } from "./db-pool.js";

test("Postgres TLS verifies certificates by default", () => {
  assert.deepEqual(databaseSslOption({}), { rejectUnauthorized: true });
  assert.deepEqual(databaseSslOption({ DATABASE_SSL: "true" }), { rejectUnauthorized: true });
});

test("DATABASE_SSL=false disables TLS", () => {
  assert.equal(databaseSslOption({ DATABASE_SSL: "false" }), false);
});

test("insecure TLS requires an explicit opt-out", () => {
  assert.deepEqual(databaseSslOption({ PGSSL_ALLOW_INSECURE: "true" }), { rejectUnauthorized: false });
  assert.deepEqual(databaseSslOption({ DATABASE_SSL_REJECT_UNAUTHORIZED: "false" }), { rejectUnauthorized: false });
  assert.deepEqual(databaseSslOption({ PGSSL_ALLOW_INSECURE: "false" }), { rejectUnauthorized: true });
  assert.deepEqual(databaseSslOption({ DATABASE_SSL_REJECT_UNAUTHORIZED: "true" }), { rejectUnauthorized: true });
});

test("a CA bundle can be supplied inline or by file", () => {
  const pem = "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----";
  assert.deepEqual(databaseSslOption({ DATABASE_SSL_CA: pem }), { rejectUnauthorized: true, ca: pem });
  assert.deepEqual(databaseSslOption({ DATABASE_SSL_CA: pem.replace(/\n/g, "\\n") }), { rejectUnauthorized: true, ca: pem });
  const dir = mkdtempSync(join(tmpdir(), "conduit-ca-"));
  const file = join(dir, "ca.pem");
  writeFileSync(file, pem);
  assert.deepEqual(databaseSslOption({ DATABASE_SSL_CA_FILE: file }), { rejectUnauthorized: true, ca: pem });
});
