import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAudit, formatAudit, runNpmAudit } from "./dep-audit.mjs";

const meta = (o = {}) => ({ info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0, ...o });
const rep = (vulns = {}, m = meta()) => ({ auditReportVersion: 2, vulnerabilities: vulns, metadata: { vulnerabilities: m } });

test("clean tree passes", () => {
  const r = evaluateAudit(rep());
  assert.equal(r.ok, true);
  assert.match(formatAudit(r, "high"), /PASS/);
});

test("high advisory fails at default level; moderate does not", () => {
  const hi = evaluateAudit(rep({ "body-parser": { name: "body-parser", severity: "high", isDirect: false, fixAvailable: true, range: "<2.2.1" } }, meta({ high: 1, total: 1 })));
  assert.equal(hi.ok, false);
  assert.equal(hi.offending[0].name, "body-parser");
  assert.match(formatAudit(hi, "high"), /FAIL[\s\S]*body-parser .*\[fix available\]/);
  const mod = evaluateAudit(rep({ x: { name: "x", severity: "moderate" } }, meta({ moderate: 1, total: 1 })));
  assert.equal(mod.ok, true);
  assert.equal(evaluateAudit(rep({ x: { name: "x", severity: "moderate" } }, meta({ moderate: 1 })), "moderate").ok, false);
});

test("fails closed on unreadable, error, or inconsistent reports", () => {
  for (const bad of [null, {}, { error: { summary: "ENOTFOUND registry" } }, { auditReportVersion: 1 }, { auditReportVersion: 2, metadata: {} }]) {
    const r = evaluateAudit(bad);
    assert.equal(r.ok, false);
    assert.ok(r.error);
    assert.match(formatAudit(r, "high"), /FAIL-CLOSED/);
  }
  assert.ok(evaluateAudit(rep({}, { info: 0, low: 0 })).error, "missing severity counts");
  // summary says critical but the package list is empty: still a failure
  assert.equal(evaluateAudit(rep({}, meta({ critical: 1 }))).ok, false);
  assert.throws(() => evaluateAudit(rep(), "severe"));
});

test("runNpmAudit is read-only and keeps the report when npm exits non-zero", () => {
  const calls = [];
  const out = runNpmAudit(true, (cmd, args) => { calls.push([cmd, ...args]); const e = new Error("exit 1"); e.stdout = '{"auditReportVersion":2}'; throw e; });
  assert.equal(out, '{"auditReportVersion":2}');
  assert.deepEqual(calls, [["npm", "audit", "--json", "--omit=dev"]]);
  assert.ok(!calls.flat().includes("fix"));
  assert.throws(() => runNpmAudit(false, () => { throw new Error("spawn npm ENOENT"); }), /ENOENT/);
});
