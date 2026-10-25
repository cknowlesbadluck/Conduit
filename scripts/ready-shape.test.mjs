import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { checkShape, loadSchema, validate } from "./ready-shape.mjs";
import { attachShape, TARGETS } from "./portfolio-probe.mjs";

const FIX = new URL("../test/fixtures/ready/", import.meta.url);
const fixture = (f) => readFileSync(new URL(f, FIX), "utf8");
const schemaFor = (file) => (file.startsWith("conduit") ? "conduit-ready" : "resonance-ready");

test("every valid /ready fixture matches its checked-in schema (offline)", () => {
  const files = readdirSync(FIX).filter((f) => f !== "invalid.json" && f.endsWith(".json"));
  assert.ok(files.length >= 4);
  for (const f of files) {
    const r = checkShape(schemaFor(f), fixture(f));
    assert.deepEqual(r.errors, [], f);
  }
});

test("invalid fixtures are rejected, and errors never echo field values", () => {
  const cases = JSON.parse(fixture("invalid.json"));
  for (const [plane, list] of Object.entries(cases)) {
    const schema = loadSchema(`${plane}-ready`);
    for (const { why, body } of list) {
      const errors = validate(schema, body);
      assert.ok(errors.length > 0, `${plane}: ${why}`);
      const text = errors.join("\n");
      for (const secret of ["postgres://x", "sk_live_abc", "Bearer abc.def", "x.supabase.co"]) assert.ok(!text.includes(secret), `${why}: ${text}`);
    }
  }
});

test("non-JSON bodies fail closed", () => {
  assert.equal(checkShape("conduit-ready", "<html>Just a moment...</html>").ok, false);
});

test("unsupported schema keywords are a hard error, not silently ignored", () => {
  assert.throws(() => validate({ type: "object", oneOf: [] }, {}), /unsupported schema keyword oneOf/);
});

test("probe pins a schema for both planes' primary /ready targets", () => {
  assert.equal(TARGETS.find((t) => t.name === "conduit").schema, "conduit-ready");
  assert.equal(TARGETS.find((t) => t.name === "resonance-netlify").schema, "resonance-ready");
});

test("attachShape: shape violation marks drift; valid shape leaves classification alone", () => {
  const target = TARGETS.find((t) => t.name === "conduit");
  const good = attachShape(target, { status: 200, body: fixture("conduit-ready.live.json") }, { outcome: "ready", ok: true, drift: false });
  assert.equal(good.shapeOk, true); assert.equal(good.drift, false); assert.equal(good.ok, true);
  const bad = attachShape(target, { status: 200, body: JSON.stringify({ status: "ready", service: "conduit", version: "0.8.0", contractRevision: "2026-10-03-ready-surface", persistence: "postgres", extra: 1 }) }, { outcome: "ready", ok: true, drift: false });
  assert.equal(bad.shapeOk, false); assert.equal(bad.drift, true); assert.equal(bad.ok, false);
  assert.equal(bad.outcome, "shape_changed");
  // No schema / no JSON body (timeout, challenge) -> untouched.
  const r = { outcome: "timeout", ok: false, drift: true };
  assert.deepEqual(attachShape(target, { error: "timeout" }, r), r);
  assert.deepEqual(attachShape({ name: "x" }, { status: 200, body: "{}" }, r), r);
});

test("inherited property names are extra fields, not schema hits (CodeRabbit #245)", () => {
  const schema = { type: "object", required: ["a"], properties: { a: { type: "string" } }, additionalProperties: false };
  for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    const body = JSON.parse(`{"a":"x",${JSON.stringify(k)}:1}`);
    assert.ok(validate(schema, body).some((e) => e.includes("unexpected field")), k);
  }
  // A required name that only exists on Object.prototype is still missing.
  assert.ok(validate({ type: "object", required: ["toString"] }, {}).some((e) => e.includes("missing required")));
});

test("conduit-ready accepts the additive production boolean from #311 (live 2026-10-25)", () => {
  const live = JSON.stringify({ status: "ready", service: "conduit", version: "0.8.0", contractRevision: "2026-10-03-ready-surface", persistence: "postgres", production: true });
  assert.equal(checkShape("conduit-ready", live).ok, true);
  const bad = JSON.stringify({ status: "ready", service: "conduit", version: "0.8.0", contractRevision: "2026-10-03-ready-surface", persistence: "postgres", production: "yes" });
  assert.equal(checkShape("conduit-ready", bad).ok, false);
});
