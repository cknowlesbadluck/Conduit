import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { databaseConnectionConfig, databaseSslOption, poolMax, databaseConfigured } from "./db-pool.js";

test("Postgres TLS verifies certificates by default", () => {
  assert.deepEqual(databaseSslOption({}), { rejectUnauthorized: true });
  assert.deepEqual(databaseSslOption({ DATABASE_SSL: "true" }), { rejectUnauthorized: true });
});

test("DATABASE_SSL=false disables TLS for local and CI databases", () => {
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
  try {
    writeFileSync(file, pem);
    assert.deepEqual(databaseSslOption({ DATABASE_SSL_CA_FILE: file }), { rejectUnauthorized: true, ca: pem });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("connection URL sslmode cannot override the explicit verified TLS policy", () => {
  const pem = "-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----";
  const config = databaseConnectionConfig({
    DATABASE_URL: "postgres://localhost:5432/conduit?sslmode=disable&application_name=conduit",
    DATABASE_SSL_CA: pem,
  });
  assert.equal(config.connectionString?.includes("sslmode"), false);
  assert.equal(config.connectionString?.includes("application_name=conduit"), true);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true, ca: pem });
});

test("connection URL sslrootcert is loaded before SSL parameters are stripped", () => {
  const dir = mkdtempSync(join(tmpdir(), "conduit-url-ca-"));
  const file = join(dir, "ca.pem");
  const pem = "-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----";
  try {
    writeFileSync(file, pem);
    const config = databaseConnectionConfig({
      DATABASE_URL: `postgres://localhost:5432/conduit?sslmode=require&sslrootcert=${encodeURIComponent(file)}`,
    });
    assert.equal(config.connectionString?.includes("sslrootcert"), false);
    assert.deepEqual(config.ssl, { rejectUnauthorized: true, ca: pem });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("database configuration and pool bounds are explicit", () => {
  assert.equal(databaseConfigured({}), false);
  assert.equal(databaseConfigured({ DATABASE_URL: "postgres://db" }), true);
  assert.equal(databaseConfigured({ DATABASE_URL: "postgres://db", CONDUIT_TEST_MEMORY: "true" }), false);
  assert.equal(poolMax({}), 10);
  assert.equal(poolMax({ DATABASE_POOL_MAX: "4" }), 4);
  assert.equal(poolMax({ DATABASE_POOL_MAX: "0" }), 1);
  assert.equal(poolMax({ DATABASE_POOL_MAX: "500" }), 50);
});
