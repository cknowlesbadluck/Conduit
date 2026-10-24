import test from "node:test";
import assert from "node:assert/strict";
import { revisionDate, revisionSkew, MAX_REVISION_SKEW_DAYS } from "./revision-skew.mjs";

const res = (c, r) => [{ name: "conduit", contractRevision: c }, { name: "resonance-netlify", contractRevision: r }];

test("revisionDate parses leading ISO date and rejects junk", () => {
  assert.equal(revisionDate("2026-10-03-ready-surface"), Date.UTC(2026, 9, 3));
  assert.equal(revisionDate("2026-02-30-x"), null);
  assert.equal(revisionDate("ready-surface"), null);
  assert.equal(revisionDate(undefined), null);
});

test("same-day revisions are ok", () => {
  const s = revisionSkew(res("2026-10-03-ready-surface", "2026-10-03-owner-gate"));
  assert.equal(s.status, "ok"); assert.equal(s.skewDays, 0); assert.equal(s.maxDays, MAX_REVISION_SKEW_DAYS);
});

test("skew beyond the constant warns; at the boundary is ok", () => {
  assert.equal(revisionSkew(res("2026-10-01-a", "2026-10-15-b")).status, "ok");
  assert.equal(revisionSkew(res("2026-10-01-a", "2026-10-16-b")).status, "warn");
  assert.equal(revisionSkew(res("2026-10-20-a", "2026-09-01-b")).skewDays, 49);
});

test("missing or unparseable revisions are unknown, never warn", () => {
  assert.equal(revisionSkew(res(undefined, "2026-10-03-x")).status, "unknown");
  assert.equal(revisionSkew([]).status, "unknown");
});
