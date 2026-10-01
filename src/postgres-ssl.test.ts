import test from "node:test";
import assert from "node:assert/strict";
import { postgresSsl, postgresTlsReport } from "./postgres-ssl.js";

test("postgres ssl stays compatible unless verify is explicitly enabled", () => {
  assert.deepEqual(postgresSsl({}), { rejectUnauthorized: false });
  assert.equal(postgresSsl({ DATABASE_SSL: "false" }), false);
  assert.deepEqual(postgresSsl({ DATABASE_SSL_REJECT_UNAUTHORIZED: "true" }), { rejectUnauthorized: true });
  assert.equal(postgresSsl({ DATABASE_SSL: "false", DATABASE_SSL_REJECT_UNAUTHORIZED: "true" }), false);
});

test("tls report never includes a connection string", () => {
  const report = postgresTlsReport({ DATABASE_URL: "postgres://user:secret@host/db", DATABASE_SSL_REJECT_UNAUTHORIZED: "true" });
  assert.deepEqual(report, { mode: "required", verify: true });
  assert.equal(JSON.stringify(report).includes("secret"), false);
});
