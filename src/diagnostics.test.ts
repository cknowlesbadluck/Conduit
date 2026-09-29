import test from "node:test";
import assert from "node:assert/strict";
import { buildDiagnosticsFromMetadata, buildAuthorizationServerMetadataCheck } from "./diagnostics.js";

test("authorization server metadata check requires issuer and endpoints", () => {
  const result = buildAuthorizationServerMetadataCheck(
    "https://auth.example.com/tenant1",
    {
      issuer: "https://auth.example.com/tenant1",
      authorization_endpoint: "https://auth.example.com/authorize",
      token_endpoint: "https://auth.example.com/token",
      jwks_uri: "https://auth.example.com/jwks",
    },
  );

  assert.deepEqual(result, { ok: true, detail: "metadata_valid" });
});

test("authorization server metadata check rejects issuer mix-up", () => {
  const result = buildAuthorizationServerMetadataCheck(
    "https://auth.example.com/tenant1",
    {
      issuer: "https://evil.example.com/tenant1",
      authorization_endpoint: "https://evil.example.com/authorize",
      token_endpoint: "https://evil.example.com/token",
      jwks_uri: "https://evil.example.com/jwks",
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.detail, "issuer_mismatch");
});

test("authorization server metadata check rejects missing token endpoint", () => {
  const result = buildAuthorizationServerMetadataCheck(
    "https://auth.example.com/tenant1",
    {
      issuer: "https://auth.example.com/tenant1",
      authorization_endpoint: "https://auth.example.com/authorize",
      jwks_uri: "https://auth.example.com/jwks",
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.detail, "missing_required_endpoint");
});

test("diagnostics preserves CIMD and DCR discovery state", () => {
  const result = buildDiagnosticsFromMetadata({
    resource: "https://conduit-feco.onrender.com/mcp",
    scopesSupported: ["mcp:conduit.read", "mcp:conduit.write"],
    configuredScopes: ["mcp:conduit.read", "mcp:conduit.write"],
    clientIdMetadataSupported: true,
    registrationEndpoint: "https://auth.example.com/register",
  });

  assert.equal(result.scopeParity.ok, true);
  assert.deepEqual(result.discovery, { cimd: true, dcr: true });
});

test("authorization server metadata check rejects insecure endpoints", () => {
  const result = buildAuthorizationServerMetadataCheck(
    "https://auth.example.com/tenant1",
    {
      issuer: "https://auth.example.com/tenant1",
      authorization_endpoint: "http://auth.example.com/authorize",
      token_endpoint: "https://auth.example.com/token",
      jwks_uri: "https://auth.example.com/jwks",
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.detail, "insecure_endpoint");
});

test("diagnostics reports missing scopes as parity failure", () => {
  const result = buildDiagnosticsFromMetadata({
    resource: "https://conduit-feco.onrender.com/mcp",
    scopesSupported: ["mcp:conduit.read"],
    configuredScopes: ["mcp:conduit.read", "mcp:conduit.write"],
    clientIdMetadataSupported: false,
  });
  assert.equal(result.scopeParity.ok, false);
  assert.deepEqual(result.scopeParity.missing, ["mcp:conduit.write"]);
  assert.deepEqual(result.discovery, { cimd: false, dcr: false });
});

import { resolveDiagnosticsTarget } from "./diagnostics.js";

test("diagnostics target ignores the Host header when OAuth is configured", () => {
  const target = resolveDiagnosticsTarget({
    authConfig: { resourceUrl: "https://conduit.example.com/mcp" } as Parameters<typeof resolveDiagnosticsTarget>[0]["authConfig"],
    requestHost: "conduit.example.com:6379",
    requestProto: "https",
    localPort: 3000,
  });
  assert.equal(target, "https://conduit.example.com");
});

test("diagnostics target prefers PUBLIC_URL over the Host header", () => {
  const target = resolveDiagnosticsTarget({ publicUrl: "https://conduit.example.com", requestHost: "evil.example:22", localPort: 3000 });
  assert.equal(target, "https://conduit.example.com");
});

test("diagnostics target without configuration only allows loopback on the listening port", () => {
  assert.equal(resolveDiagnosticsTarget({ requestHost: "127.0.0.1:3000", localPort: 3000 }), "http://127.0.0.1:3000");
  assert.equal(resolveDiagnosticsTarget({ requestHost: "localhost:3000", localPort: 3000 }), "http://localhost:3000");
  assert.throws(() => resolveDiagnosticsTarget({ requestHost: "127.0.0.1:6379", localPort: 3000 }), /diagnostics_target_not_allowed/);
  assert.throws(() => resolveDiagnosticsTarget({ requestHost: "10.0.0.5:3000", localPort: 3000 }), /diagnostics_target_not_allowed/);
  assert.throws(() => resolveDiagnosticsTarget({ requestHost: "localhost", localPort: 3000 }), /diagnostics_target_not_allowed/);
  assert.throws(() => resolveDiagnosticsTarget({ requestHost: "user@localhost:3000", localPort: 3000 }), /diagnostics_target_not_allowed/);
  assert.throws(() => resolveDiagnosticsTarget({ localPort: 3000 }), /diagnostics_target_not_allowed/);
});
