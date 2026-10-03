import test from "node:test";
import assert from "node:assert/strict";
import { classifyHost, classifyResonanceReady, PUBLIC_RESONANCE_HOST } from "./host-identity.js";

test("only the Netlify public host is the gate", () => {
  assert.equal(classifyHost(`https://${PUBLIC_RESONANCE_HOST}/api/ready`), "public_gate");
  assert.equal(classifyHost("https://resonance-2in3qv6ni-inbetweenz.vercel.app/api/ready"), "alias");
  assert.equal(classifyHost("not a url"), "invalid");
});

test("a 200 on a Vercel alias is not proof", () => {
  assert.equal(classifyResonanceReady({
    url: "https://resonance-2in3qv6ni-inbetweenz.vercel.app/api/ready",
    status: 200,
    missingRequired: [],
    hasOwnerActionRequired: false,
    contractRevision: "2026-10-03-owner-gate",
  }), "wrong_host");
});

test("public 503 missing the service role is owner blocked, not deploy lag", () => {
  assert.equal(classifyResonanceReady({
    url: "https://resonancenexus.netlify.app/api/ready",
    status: 503,
    missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
    hasOwnerActionRequired: false,
  }), "owner_blocked");
});

test("public 503 that omits the contract and is not missing the key is deploy lag", () => {
  assert.equal(classifyResonanceReady({
    url: "https://resonancenexus.netlify.app/api/ready",
    status: 503,
    missingRequired: [],
    hasOwnerActionRequired: false,
  }), "deploy_lag");
});

test("public 200 with the expected contract and no owner action is ready", () => {
  assert.equal(classifyResonanceReady({
    url: "https://resonancenexus.netlify.app/api/ready",
    status: 200,
    missingRequired: [],
    hasOwnerActionRequired: false,
    contractRevision: "2026-10-03-owner-gate",
  }), "ready");
});
