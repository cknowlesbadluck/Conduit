import test from "node:test";
import assert from "node:assert/strict";
import { classifyHost, classifyResonanceReady, parseReadyProbe, PUBLIC_RESONANCE_HOST } from "./host-identity.js";

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

test("01:01Z public body is owner blocked even without contract fields", () => {
  const parsed = parseReadyProbe({
    url: "https://resonancenexus.netlify.app/api/ready",
    status: 503,
    body: JSON.stringify({
      status: "not_ready",
      service: "resonance-nexus",
      missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
      authMode: "required",
      authModeOk: true,
      persistenceConfigured: false,
    }),
  });
  assert.equal(parsed.json, true);
  assert.equal(parsed.hostClass, "public_gate");
  assert.equal(parsed.readyClass, "owner_blocked");
  assert.equal(parsed.contractRevision, undefined);
  assert.equal(parsed.ssoChallenge, false);
});

test("01:01Z Vercel SSO redirect is an alias challenge, not a deploy", () => {
  const parsed = parseReadyProbe({
    url: "https://resonance-2in3qv6ni-inbetweenz.vercel.app/api/ready",
    status: 302,
    location: "https://vercel.com/sso-api?url=https%3A%2F%2Fresonance-2in3qv6ni-inbetweenz.vercel.app%2Fapi%2Fready",
    body: "Protected by Vercel Authentication",
  });
  assert.equal(parsed.json, false);
  assert.equal(parsed.ssoChallenge, true);
  assert.equal(parsed.hostClass, "alias");
  assert.equal(parsed.readyClass, "wrong_host");
});
