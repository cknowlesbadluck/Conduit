import test from "node:test";
import assert from "node:assert/strict";
import { assertAgentMayMerge, classifyPull, discretionaryCount } from "./automation-hold.js";

const bolt = { repo: "Conduit", number: 188, title: "⚡ Bolt: optimize keyset cursor validation and task filter construction", author: "cknowlesbadluck", mergeableState: "unstable" };
const dependabot = { repo: "QuicksilverV1", number: 209, title: "chore(deps): bump actions/checkout from 4 to 7 in the actions group", author: "dependabot[bot]", mergeableState: "unstable" };
const lattice = { repo: "Conduit", number: 187, title: "feat: portfolio cutover lattice", mergeableState: "unstable" };
const keep = { repo: "Conduit", number: 155, title: "DB TLS: verify Postgres certificates by default", mergeableState: "clean" };

test("bolt and dependabot are automation holds, not discretionary scope", () => {
  assert.equal(classifyPull(bolt), "automation");
  assert.equal(classifyPull(dependabot), "automation");
  assert.equal(classifyPull(lattice), "lattice");
  assert.equal(classifyPull(keep), "keep_red");
  assert.equal(discretionaryCount([bolt, dependabot, lattice, keep]), 1);
});

test("agent cannot merge an unstable bolt pull or a keep-red pull", () => {
  assert.throws(() => assertAgentMayMerge(bolt), /refusing to merge automation/);
  assert.throws(() => assertAgentMayMerge(keep), /refusing to merge keep-red/);
  assert.throws(() => assertAgentMayMerge(lattice), /owner gate is open/);
});
