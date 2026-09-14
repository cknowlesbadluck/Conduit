import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { postgresSsl } from "./db-ssl.js";

const keys = ["DATABASE_SSL", "DATABASE_SSL_REJECT_UNAUTHORIZED"] as const;

afterEach(() => {
  for (const key of keys) delete process.env[key];
});

describe("postgresSsl", () => {
  it("disables TLS when DATABASE_SSL=false", () => {
    process.env.DATABASE_SSL = "false";
    assert.equal(postgresSsl(), false);
  });

  it("verifies certificates by default", () => {
    delete process.env.DATABASE_SSL;
    delete process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
    assert.deepEqual(postgresSsl(), { rejectUnauthorized: true });
  });

  it("allows opting out of verification for managed certs", () => {
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = "false";
    assert.deepEqual(postgresSsl(), { rejectUnauthorized: false });
  });
});

describe("pool wiring", () => {
  it("store.ts uses postgresSsl instead of a hard-coded rejectUnauthorized:false", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const source = await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "store.ts"), "utf8");
    assert.match(source, /postgresSsl\(\)/);
    assert.doesNotMatch(source, /rejectUnauthorized:\s*false/);
  });
});
