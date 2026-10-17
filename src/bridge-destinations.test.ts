import test from "node:test";
import assert from "node:assert/strict";
import {
  bridgeDestinationMode, bridgeDestinationStatus, checkBridgeDestination, matchesAllowlistEntry, matchesRegisteredEndpoint,
  parseAllowlist, parseAllowlistEntry, redactHost, resetBridgeDestinationStatsForTests,
} from "./bridge-destinations.js";
import { createConduitServer } from "./mcp.js";
import { setMcpBridgeLookupForTests, setMcpBridgeTransportForTests } from "./mcp-bridge.js";
import { init, registerResource, registerAgent, registerTool, listRegisteredEndpoints } from "./store.js";
import { buildDiagnosticsFromMetadata, runDiagnostics } from "./diagnostics.js";

const MODE = "CONDUIT_BRIDGE_DESTINATION_MODE";
const LIST = "CONDUIT_BRIDGE_ALLOWED_DESTINATIONS";
const none = async () => [] as string[];
const u = (s: string) => new URL(s);

test.afterEach(() => {
  delete process.env[MODE];
  delete process.env[LIST];
  resetBridgeDestinationStatsForTests();
  setMcpBridgeLookupForTests();
  setMcpBridgeTransportForTests();
});

test("mode defaults to report; enforce/off are opt-in; unknown values fall back to report (never refuse on a typo)", () => {
  assert.deepEqual(bridgeDestinationMode({}), { mode: "report", valid: true });
  assert.deepEqual(bridgeDestinationMode({ [MODE]: " ENFORCE " }), { mode: "enforce", valid: true });
  assert.deepEqual(bridgeDestinationMode({ [MODE]: "off" }), { mode: "off", valid: true });
  assert.deepEqual(bridgeDestinationMode({ [MODE]: "enforcing" }), { mode: "report", valid: false });
});

test("allowlist entries: exact origin, exact host, leading *. subdomain only", () => {
  assert.deepEqual(parseAllowlistEntry("https://MCP.Example.com"), { kind: "origin", origin: "https://mcp.example.com" });
  assert.deepEqual(parseAllowlistEntry("https://mcp.example.com:8443/"), { kind: "origin", origin: "https://mcp.example.com:8443" });
  assert.deepEqual(parseAllowlistEntry("api.example.com"), { kind: "host", host: "api.example.com" });
  assert.deepEqual(parseAllowlistEntry("*.example.com"), { kind: "subdomain", suffix: "example.com" });
  for (const bad of ["http://mcp.example.com", "https://mcp.example.com/mcp", "https://*.example.com", "*.com", "*", "a.*.example.com", "*.*.example.com",
    "mcp*.example.com", "https://user:pw@mcp.example.com", "api.example.com:443", "example.com/path", "-bad-.example.com", "https://x.com?q=1"]) {
    assert.equal(parseAllowlistEntry(bad), null, bad);
  }
  assert.deepEqual(parseAllowlist(" api.example.com, ,*.foo.dev,https://*.bad.com ").invalid, 1);
  assert.equal(parseAllowlist(" api.example.com, ,*.foo.dev,https://*.bad.com ").entries.length, 2);
});

test("allowlist matching never widens: subdomain rule excludes the apex and look-alike suffixes; origin is port-exact", () => {
  const sub = parseAllowlistEntry("*.example.com")!;
  assert.equal(matchesAllowlistEntry(u("https://mcp.example.com/x"), sub), true);
  assert.equal(matchesAllowlistEntry(u("https://a.b.example.com/x"), sub), true);
  assert.equal(matchesAllowlistEntry(u("https://example.com/x"), sub), false);
  assert.equal(matchesAllowlistEntry(u("https://evilexample.com/x"), sub), false);
  assert.equal(matchesAllowlistEntry(u("https://example.com.evil.net/x"), sub), false);
  const origin = parseAllowlistEntry("https://mcp.example.com")!;
  assert.equal(matchesAllowlistEntry(u("https://mcp.example.com/mcp"), origin), true);
  assert.equal(matchesAllowlistEntry(u("https://mcp.example.com:8443/mcp"), origin), false);
  const host = parseAllowlistEntry("mcp.example.com")!;
  assert.equal(matchesAllowlistEntry(u("https://mcp.example.com:8443/mcp"), host), true);
  assert.equal(matchesAllowlistEntry(u("https://x.mcp.example.com/mcp"), host), false);
});

test("registered endpoints match by exact HTTPS origin only", () => {
  const reg = ["https://tools.example.com/mcp", "http://plain.example.com/mcp", "not a url"];
  assert.equal(matchesRegisteredEndpoint(u("https://tools.example.com/other"), reg), true);
  assert.equal(matchesRegisteredEndpoint(u("https://tools.example.com:444/mcp"), reg), false);
  assert.equal(matchesRegisteredEndpoint(u("https://plain.example.com/mcp"), reg), false);
  assert.equal(matchesRegisteredEndpoint(u("https://sub.tools.example.com/mcp"), reg), false);
});

test("redactHost keeps only the last two labels plus a stable hash; IP literals are fully hidden", () => {
  assert.match(redactHost("secret-tenant.internal-svc.example.com"), /^\*\.example\.com#[0-9a-f]{8}$/);
  assert.equal(redactHost("A.example.com"), redactHost("a.example.com"));
  assert.match(redactHost("example.com"), /^example\.com#[0-9a-f]{8}$/);
  assert.match(redactHost("93.184.216.34"), /^ip-literal#[0-9a-f]{8}$/);
  assert.doesNotMatch(redactHost("secret-tenant.example.com"), /secret/);
});

test("report mode allows unknown destinations but counts them; enforce refuses; off skips the lookup", async () => {
  let lookups = 0;
  const reg = async () => { lookups += 1; return ["https://tools.example.com/mcp"]; };
  const d1 = await checkBridgeDestination(u("https://unknown.example.net/mcp"), reg, {});
  assert.deepEqual(d1, { mode: "report", allowed: true, matched: null, violation: true });
  assert.equal(bridgeDestinationStatus({}).violations, 1);
  const d2 = await checkBridgeDestination(u("https://unknown.example.net/mcp"), reg, { [MODE]: "enforce" });
  assert.deepEqual(d2, { mode: "enforce", allowed: false, matched: null, violation: true });
  assert.equal(bridgeDestinationStatus({}).violations, 2);
  assert.ok(bridgeDestinationStatus({}).lastViolationAt);
  const d3 = await checkBridgeDestination(u("https://tools.example.com/mcp"), reg, { [MODE]: "enforce" });
  assert.deepEqual(d3, { mode: "enforce", allowed: true, matched: "registered", violation: false });
  const before = lookups;
  const d4 = await checkBridgeDestination(u("https://a.allowed.dev/mcp"), reg, { [MODE]: "enforce", [LIST]: "*.allowed.dev" });
  assert.deepEqual(d4, { mode: "enforce", allowed: true, matched: "allowlist", violation: false });
  assert.equal(lookups, before, "allowlist hit short-circuits the registry lookup");
  const d5 = await checkBridgeDestination(u("https://unknown.example.net/mcp"), reg, { [MODE]: "off" });
  assert.deepEqual(d5, { mode: "off", allowed: true, matched: null, violation: false });
  assert.equal(lookups, before);
  assert.equal(bridgeDestinationStatus({}).violations, 2);
});

test("registry lookup failure: report still allows (counted); enforce fails closed", async () => {
  const broken = async () => { throw new Error("db down"); };
  assert.equal((await checkBridgeDestination(u("https://x.example.net/"), broken, {})).allowed, true);
  assert.equal((await checkBridgeDestination(u("https://x.example.net/"), broken, { [MODE]: "enforce" })).allowed, false);
  assert.equal(bridgeDestinationStatus({}).violations, 2);
});

test("status exposes mode, allowlist size and violation count but never hosts", async () => {
  await checkBridgeDestination(u("https://leaky-host.example.net/"), none, {});
  const status = bridgeDestinationStatus({ [MODE]: "bogus", [LIST]: "a.example.com,*.b.example.com,*bad" });
  assert.deepEqual({ ...status, lastViolationAt: typeof status.lastViolationAt }, {
    mode: "report", modeValid: false, allowlistEntries: 2, invalidAllowlistEntries: 1, violations: 1, lastViolationAt: "string",
  });
  assert.doesNotMatch(JSON.stringify(status), /leaky-host/);
});

test("runDiagnostics carries bridgeDestinations next to scopeParity", async () => {
  process.env[MODE] = "enforce";
  const diag = await runDiagnostics(undefined, "https://conduit.invalid");
  assert.equal(diag.bridgeDestinations?.mode, "enforce");
  assert.equal(diag.bridgeDestinations?.violations, 0);
  assert.equal(typeof buildDiagnosticsFromMetadata, "function");
});

test("listRegisteredEndpoints returns non-archived HTTPS tool and resource endpoints (memory and Postgres stores)", async () => {
  await init();
  const agent = `dest-${Math.random().toString(36).slice(2, 8)}`;
  await registerAgent({ id: agent, name: agent });
  await registerTool(`${agent}-tool`, "t", "https://tool-reg.example.com/mcp", undefined, agent);
  await registerTool(`${agent}-plain`, "t", "http://plain-reg.example.com/mcp", undefined, agent);
  await registerResource({ name: `${agent}-res`, description: "r", kind: "mcp", endpoint: "https://res-reg.example.com/mcp", createdBy: agent });
  const endpoints = await listRegisteredEndpoints();
  assert.ok(endpoints.includes("https://tool-reg.example.com/mcp"));
  assert.ok(endpoints.includes("https://res-reg.example.com/mcp"));
  assert.ok(!endpoints.includes("http://plain-reg.example.com/mcp"));
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper reads arbitrary result shapes
type Result = { isError?: boolean; structuredContent?: any; content?: Array<{ text?: string }> };
type Handler = (input: unknown, extra: unknown) => Promise<Result>;

async function bridgeTool() {
  await init();
  const server = createConduitServer() as unknown as { _registeredTools: Record<string, { handler: Handler }> };
  let calls = 0;
  setMcpBridgeLookupForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
  setMcpBridgeTransportForTests(async () => { calls += 1; return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }), { status: 200, headers: { "content-type": "application/json" } }); });
  return { call: server._registeredTools.mcp_bridge_call.handler, calls: () => calls };
}

async function captureWarn<T>(fn: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const original = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try { return { value: await fn(), lines }; } finally { console.warn = original; }
}

test("mcp_bridge_call default (report): unknown destination is forwarded, logged with a redacted host, and counted", async () => {
  const { call, calls } = await bridgeTool();
  const { value, lines } = await captureWarn(() => call({ endpoint: "https://secret-tenant.unlisted.example.org/mcp", method: "tools/list", id: 1 }, {}));
  assert.notEqual(value.isError, true);
  assert.equal(calls(), 1);
  const violation = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((l) => l?.type === "mcp.bridge.destination.violation");
  assert.ok(violation, "violation logged");
  assert.equal(violation.mode, "report");
  assert.equal(violation.action, "allowed_report_only");
  assert.match(violation.host, /^\*\.example\.org#[0-9a-f]{8}$/);
  assert.doesNotMatch(lines.join("\n"), /secret-tenant/);
  assert.equal(bridgeDestinationStatus().violations, 1);
});

test("mcp_bridge_call enforce: unknown destination is refused before any network call; allowlisted one is forwarded", async () => {
  process.env[MODE] = "enforce";
  process.env[LIST] = "https://allowed.example.org";
  const { call, calls } = await bridgeTool();
  const refused = await captureWarn(() => call({ endpoint: "https://other.example.org/mcp", method: "tools/list", id: 1 }, {}));
  assert.equal(refused.value.isError, true);
  assert.match(JSON.stringify(refused.value), /mcp_endpoint_not_allowlisted/);
  assert.equal(calls(), 0);
  const ok = await call({ endpoint: "https://allowed.example.org/mcp", method: "tools/list", id: 2 }, {});
  assert.notEqual(ok.isError, true);
  assert.equal(calls(), 1);
});

test("mcp_bridge_call enforce: SSRF guard still applies to allowlisted hosts", async () => {
  process.env[MODE] = "enforce";
  process.env[LIST] = "localhost,127.0.0.1";
  const { call, calls } = await bridgeTool();
  const r = await captureWarn(() => call({ endpoint: "https://127.0.0.1/mcp", method: "tools/list", id: 1 }, {}));
  assert.equal(r.value.isError, true);
  assert.match(JSON.stringify(r.value), /mcp_endpoint_local_target/);
  assert.equal(calls(), 0);
});
