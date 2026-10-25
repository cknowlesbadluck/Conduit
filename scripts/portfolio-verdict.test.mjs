import test from "node:test";
import assert from "node:assert/strict";
import { classifyPlane, portfolioVerdict, revisionDate } from "./portfolio-verdict.mjs";

const NOW = "2026-10-25T09:00:00Z";
const body = (o = {}) => ({ status: "ready", service: "conduit", contractRevision: "2026-10-20-x", production: true, ...o });
const ok = (b = body()) => ({ status: 200, body: b });
const c = (attempts, o = {}) => classifyPlane({ attempts }, { now: NOW, ...o });

test("ready on first 200", () => assert.equal(c([ok()]).state, "ready"));
test("503 then 200 is degraded_cold_start", () => {
  const r = c([{ status: 503 }, { error: "timeout" }, ok()]);
  assert.equal(r.state, "degraded_cold_start"); assert.equal(r.firstOkAttempt, 3);
});
test("never 200 is not_ready", () => assert.equal(c([{ status: 503 }, { error: "timeout" }]).state, "not_ready"));
test("hard 500 before 200 is not_ready", () => assert.equal(c([{ status: 500 }, ok()]).reason, "hard_error_before_200"));
test("200 then 503 is not_ready", () => assert.equal(c([ok(), { status: 503 }]).reason, "regressed_after_200"));
test("500 with timeout error is hard", () => assert.equal(c([{ status: 500, error: "timeout" }, ok()]).state, "not_ready"));
test("production false/missing is not_ready", () => {
  assert.equal(c([ok(body({ production: false }))]).reason, "production_not_true");
  assert.equal(c([ok(body({ production: "true" }))]).reason, "production_not_true");
  const b = body(); delete b.production;
  assert.equal(c([ok(b)]).reason, "missing_contract_fields");
});
test("missing contract fields is not_ready", () => {
  const b = body(); delete b.contractRevision;
  assert.deepEqual(c([ok(b)]).missing, ["contractRevision"]);
});
test("stale revision (>14d) is drift", () => {
  const r = c([ok(body({ contractRevision: "2026-10-03-ready-surface" }))]);
  assert.equal(r.state, "drift"); assert.equal(r.ageDays, 22);
});
test("exactly 14 days is still fresh", () => assert.equal(c([ok(body({ contractRevision: "2026-10-11-x" }))]).state, "ready"));
test("shape mismatch and unparseable revision are drift", () => {
  assert.equal(c([ok(body({ contractRevision: 7 }))]).reason, "contract_shape_mismatch");
  assert.equal(c([ok(body({ contractRevision: "latest" }))]).reason, "unparseable_contract_revision");
  assert.equal(c([ok(body({ contractRevision: "2026-02-31-x" }))]).reason, "unparseable_contract_revision");
});
test("malformed input fails closed", () => {
  for (const p of [null, undefined, 1, "x", [], {}, { attempts: [] }, { attempts: "x" }, { attempts: [null] }])
    assert.equal(classifyPlane(p, { now: NOW }).state, "not_ready");
  assert.equal(c([ok("nope")]).state, "not_ready");
  assert.equal(c([ok()], { now: "garbage" }).state, "not_ready");
  assert.equal(c([ok()], { maxRevisionAgeDays: NaN }).state, "not_ready");
});
test("revisionDate", () => {
  assert.equal(revisionDate("2026-10-03-owner-gate"), Date.UTC(2026, 9, 3));
  assert.equal(revisionDate("2026-10-03"), Date.UTC(2026, 9, 3));
  assert.equal(revisionDate("2026-10-033"), null);
  assert.equal(revisionDate(null), null);
});
test("portfolio verdict is worst plane", () => {
  const v = portfolioVerdict({ now: NOW, planes: { conduit: { attempts: [{ status: 503 }, ok()] }, resonance: { attempts: [ok()] } } });
  assert.equal(v.verdict, "degraded_cold_start");
  assert.equal(portfolioVerdict({ now: NOW, planes: { a: { attempts: [ok()] }, b: { attempts: [ok(body({ contractRevision: "2026-01-01" }))] } } }).verdict, "drift");
  assert.equal(portfolioVerdict({ now: NOW, planes: { a: { attempts: [ok()] }, b: null } }).verdict, "not_ready");
});
test("portfolio fails closed on bad input", () => {
  for (const i of [null, {}, { planes: {} }, { planes: [] }]) assert.equal(portfolioVerdict(i).verdict, "not_ready");
});
test("2026-10-25 05:00 ET live snapshot: both planes 200 but revisions >14d -> drift", () => {
  const v = portfolioVerdict({ now: NOW, planes: {
    conduit: { attempts: [ok(body({ contractRevision: "2026-10-03-ready-surface" }))] },
    resonance: { attempts: [ok(body({ service: "resonance-nexus", contractRevision: "2026-10-03-owner-gate" }))] } } });
  assert.equal(v.verdict, "drift");
});
