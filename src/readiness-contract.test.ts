// Conformance: the actual /ready handler output must satisfy the vendored
// portable readiness contract (schemas/readiness/v1.schema.json).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createConduitApp } from "./app-factory.js";
import { init } from "./store.js";
import { READINESS_CONTRACT_VERSION, readyBody, sanitizeMissingRequired } from "./health-contract.js";

type Schema = Record<string, unknown>;
const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), "../schemas/readiness/v1.schema.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Schema;

const ANNOTATIONS = new Set(["$schema", "$id", "title", "description", "x-contract-version"]);
const KNOWN = new Set(["type", "required", "properties", "additionalProperties", "enum", "pattern", "minLength", "maxLength", "items", "uniqueItems", "maxItems"]);

/** Zero-dependency validator for the keyword subset the contract uses. Unknown keywords fail loudly. */
function validate(node: Schema, value: unknown, path = "$"): string[] {
  for (const key of Object.keys(node)) {
    if (!ANNOTATIONS.has(key) && !KNOWN.has(key)) throw new Error(`unsupported schema keyword ${key} at ${path}`);
  }
  const errors: string[] = [];
  const type = node.type as string | undefined;
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [`${path}: expected object`];
    const record = value as Record<string, unknown>;
    for (const key of (node.required as string[] | undefined) ?? []) if (!(key in record)) errors.push(`${path}.${key}: required`);
    const props = (node.properties as Record<string, Schema> | undefined) ?? {};
    for (const [key, child] of Object.entries(record)) {
      if (props[key]) errors.push(...validate(props[key], child, `${path}.${key}`));
      else if (node.additionalProperties === false) errors.push(`${path}.${key}: not allowed`);
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    if (typeof node.maxItems === "number" && value.length > node.maxItems) errors.push(`${path}: too many items`);
    if (node.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${path}: duplicate items`);
    if (node.items) value.forEach((item, index) => errors.push(...validate(node.items as Schema, item, `${path}[${index}]`)));
  } else if (type === "string") {
    if (typeof value !== "string") return [`${path}: expected string`];
    if (typeof node.minLength === "number" && value.length < node.minLength) errors.push(`${path}: too short`);
    if (typeof node.maxLength === "number" && value.length > node.maxLength) errors.push(`${path}: too long`);
    if (typeof node.pattern === "string" && !new RegExp(node.pattern, "u").test(value)) errors.push(`${path}: pattern mismatch`);
  } else if (type !== undefined) {
    throw new Error(`unsupported type ${type} at ${path}`);
  }
  if (Array.isArray(node.enum) && !node.enum.includes(value)) errors.push(`${path}: not in enum`);
  return errors;
}

test("vendored schema is contract v1 and matches the code's contract version", () => {
  assert.equal(schema["x-contract-version"], READINESS_CONTRACT_VERSION);
  assert.equal(READINESS_CONTRACT_VERSION, "v1");
});

test("readyBody output conforms to readiness contract v1 in every state", () => {
  const cases = [
    readyBody({ initialized: true, persistenceOk: true, persistence: "postgres" }),
    readyBody({ initialized: true, persistenceOk: false, persistence: "postgres" }),
    readyBody({ initialized: false, persistenceOk: false, persistence: "memory" }),
    readyBody({ initialized: true, persistenceOk: true, persistence: "memory", commitSha: "unknown" }),
    readyBody({ initialized: true, persistenceOk: true, persistence: "postgres", commitSha: "2a6745b" }),
    readyBody({ initialized: true, persistenceOk: true, persistence: "postgres", missingRequired: ["DATABASE_URL"] }),
  ];
  for (const body of cases) assert.deepEqual(validate(schema, body), [], JSON.stringify(body));
});

test("missingRequired is names-only, deduplicated, and forces not-ready", () => {
  const body = readyBody({
    initialized: true,
    persistenceOk: true,
    persistence: "postgres",
    missingRequired: ["DATABASE_URL", "DATABASE_URL", "postgres://user:pw@host/db", "lower_case"],
  });
  assert.deepEqual(body.missingRequired, ["DATABASE_URL"]);
  assert.notEqual(body.status, "ready");
  assert.deepEqual(sanitizeMissingRequired(undefined), []);
  assert.equal(JSON.stringify(body).includes("pw@host"), false);
});

test("validator actually enforces the contract (negative cases)", () => {
  const good = readyBody({ initialized: true, persistenceOk: true, persistence: "memory", commitSha: "unknown" });
  const bad: Array<Record<string, unknown>> = [
    { ...good, status: "ok" },
    { ...good, version: undefined },
    { ...good, commitSha: "https://example.test" },
    { ...good, missingRequired: ["sk_live_value"] },
    { ...good, missingRequired: "DATABASE_URL" },
    { ...good, stage: "" },
  ];
  for (const body of bad) {
    const clean = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
    assert.notDeepEqual(validate(schema, clean), [], JSON.stringify(clean));
  }
  assert.throws(() => validate({ type: "string", format: "uri" }, "x"), /unsupported schema keyword/);
});

test("live GET /ready from the app factory conforms and its HTTP code agrees with status", async () => {
  await init();
  const server = createServer(createConduitApp({ anonymous: true }));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(validate(schema, body), []);
    assert.equal(response.status, body.status === "ready" ? 200 : 503);
    assert.equal(body.service, "conduit");
    assert.equal(body.stage, "deployment");
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});
