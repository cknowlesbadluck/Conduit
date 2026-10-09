import test from "node:test";
import assert from "node:assert/strict";
import { DEVICE_FENCE_LANDED, classifyLanded, holdContradictions } from "./landed-fence.js";

test("merged device fence without a device record is unverified", () => {
  assert.equal(classifyLanded(DEVICE_FENCE_LANDED), "landed_unverified");
  assert.equal(DEVICE_FENCE_LANDED.sha, "83f13504cda74e4150baab3be3de70f2251ab441");
  assert.deepEqual(holdContradictions([241, 242], [DEVICE_FENCE_LANDED]), [241]);
});

test("a recorded device gate is acceptance", () => {
  assert.equal(classifyLanded({ ...DEVICE_FENCE_LANDED, deviceRecorded: true }), "landed_accepted");
});
