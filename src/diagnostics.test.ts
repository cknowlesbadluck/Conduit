import test from "node:test";
import assert from "node:assert/strict";
import { buildDiagnosticsFromMetadata } from "./diagnostics.js";

test("diagnostics reports scope parity and CIMD/DCR advertisement without secrets", () => {
  const result = buildDiagnosticsFromMetadata({
    resource: "https://conduit.example/mcp",
    scopesSupported: ["mcp:conduit.read", "mcp:conduit.write"],
    configuredScopes: ["mcp:conduit.read", "mcp:conduit.write"],
    clientIdMetadataSupported: true,
    registrationEndpoint: "https://auth.example/register",
  });
  assert.equal(result.scopeParity.ok, true);
  assert.equal(result.discovery.cimd, true);
  assert.equal(result.discovery.dcr, true);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
