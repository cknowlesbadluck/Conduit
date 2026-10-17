import test from "node:test";
import assert from "node:assert/strict";
import { classifyAlias, summarizeAliases } from "./stranger-alias.js";

test("404 DEPLOYMENT_NOT_FOUND is alias_absent and not phase-admitted", () => {
  const decision = classifyAlias({
    host: "resonancenexus.vercel.app",
    status: 404,
    body: "The deployment could not be found on Vercel.\n\nDEPLOYMENT_NOT_FOUND\n",
  });
  assert.equal(decision.classification, "alias_absent");
  assert.equal(decision.phaseAdmitted, false);
  assert.equal(decision.owned, false);
});

test("200 HTML without a portfolio marker is stranger_occupant", () => {
  const summary = summarizeAliases([
    {
      host: "resonance.vercel.app",
      status: 200,
      body: "<!DOCTYPE html><html><title>Detail Framework</title></html>",
    },
    {
      host: "quicksilver.vercel.app",
      status: 200,
      body: "<!DOCTYPE html><html><title>Canawan</title></html>",
    },
  ]);
  assert.deepEqual(summary.strangerHosts, ["resonance.vercel.app", "quicksilver.vercel.app"]);
  assert.equal(summary.phaseAdmitted, false);
  assert.deepEqual(summary.ownedHosts, []);
});

test("owned marker does not admit a phase", () => {
  const decision = classifyAlias({
    host: "owned.example",
    status: 200,
    body: "<html>resonance-nexus</html>",
  });
  assert.equal(decision.classification, "alias_owned");
  assert.equal(decision.owned, true);
  assert.equal(decision.phaseAdmitted, false);
});

test("404 with DEPLOYMENT_NOT_FOUND only in x-vercel-error is alias_absent", () => {
  const decision = classifyAlias({ host: "gone.vercel.app", status: 404, body: "", vercelError: "DEPLOYMENT_NOT_FOUND" });
  assert.equal(decision.classification, "alias_absent");
});

test("a known stranger page spoofing an owned marker is stranger_occupant, not owned", () => {
  const decision = classifyAlias({
    host: "spoof.vercel.app",
    status: 200,
    body: "<!DOCTYPE html><html><title>Canawan</title><!-- quicksilverv1 --></html>",
  });
  assert.equal(decision.classification, "stranger_occupant");
  assert.equal(decision.owned, false);
});
