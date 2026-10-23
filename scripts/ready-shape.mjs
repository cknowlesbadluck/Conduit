#!/usr/bin/env node
/**
 * Cross-plane /ready shape contract — zero-dependency, offline-testable.
 *
 * Validates a /ready payload against the JSON Schema checked into schemas/ready/
 * (conduit-ready.schema.json, resonance-ready.schema.json). Only the subset of
 * JSON Schema those files use is implemented: type, const, enum, required,
 * properties, additionalProperties:false, items, pattern, maxLength. Any other
 * keyword is a hard error so the schema cannot silently stop being enforced.
 *
 * Unit tests run against fixtures in test/fixtures/ready/ (no network). The live
 * check is wired into scripts/portfolio-probe.mjs (targets with `schema`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SUPPORTED = new Set(["$schema", "$id", "title", "description", "type", "const", "enum", "required", "properties", "additionalProperties", "items", "pattern", "maxLength"]);

export function loadSchema(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`bad schema name: ${name}`);
  return JSON.parse(readFileSync(join(ROOT, "schemas", "ready", `${name}.schema.json`), "utf8"));
}

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
}

/** Returns a list of error strings ("" path = root). Empty list = valid. */
export function validate(schema, value, path = "$") {
  for (const k of Object.keys(schema)) if (!SUPPORTED.has(k)) throw new Error(`unsupported schema keyword ${k} at ${path}`);
  const errors = [];
  if (schema.type !== undefined) {
    const t = typeOf(value);
    const ok = schema.type === t || (schema.type === "number" && t === "integer");
    if (!ok) return [`${path}: expected ${schema.type}, got ${t}`];
  }
  if ("const" in schema && value !== schema.const) errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not in enum ${JSON.stringify(schema.enum)}`);
  if (typeof value === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match ${schema.pattern}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
  }
  if (typeOf(value) === "object") {
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    for (const req of schema.required ?? []) if (!own(value, req)) errors.push(`${path}: missing required ${req}`);
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(value)) {
      // Field names only: values are never copied into errors (they may be secrets).
      // Own properties only: inherited names (constructor, toString, __proto__) must not
      // resolve to Object.prototype members and bypass additionalProperties:false.
      if (own(props, k)) errors.push(...validate(props[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected field ${JSON.stringify(k.slice(0, 64))}`);
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
  return errors;
}

/** Validate a raw response body string. Never throws on bad input; returns { ok, errors }. */
export function checkShape(schemaName, body) {
  let json;
  try { json = JSON.parse(body); } catch { return { ok: false, errors: ["$: body is not JSON"] }; }
  const errors = validate(loadSchema(schemaName), json);
  return { ok: errors.length === 0, errors };
}
