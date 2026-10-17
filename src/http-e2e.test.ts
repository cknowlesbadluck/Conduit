import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createConduitApp } from "./app-factory.js";
import { MCP_PROTOCOL_VERSION, SERVICE_NAME } from "./version.js";
import { init, registerAgent, createProject, createTask } from "./store.js";
import { request as httpRequest } from "node:http";
import { DIAGNOSTICS_RATE_LIMITER } from "./rate-limit.js";
import type { ConduitAuthConfig } from "./auth.js";
import type { AuthInfo } from "@modelcontextprotocol/server";

function testAuthConfig(resourceUrl: string): ConduitAuthConfig {
  return {
    enabled: true,
    issuer: "https://auth.example.test/issuer",
    discoveryUrl: "https://auth.example.test/.well-known/oauth-authorization-server",
    resourceUrl,
    metadata: {
      issuer: "https://auth.example.test/issuer",
      jwks_uri: "https://auth.example.test/jwks",
      authorization_endpoint: "https://auth.example.test/authorize",
      token_endpoint: "https://auth.example.test/token",
      response_types_supported: ["code"],
    },
    readScope: "mcp:conduit.read",
    writeScope: "mcp:conduit.write",
  };
}

const mcpHeaders = () => ({
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
  "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
});

async function readMcpResponse(response: Response) {
  const text = await response.text();
  const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data: "));
  assert.ok(dataLine, `expected MCP SSE data event, received: ${text}`);
  return JSON.parse(dataLine.slice("data: ".length)) as { result?: Record<string, unknown> };
}

test("black-box MCP HTTP initializes and lists tools", async () => {
  await init();
  const app = createConduitApp({ anonymous: true });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const initialize = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "conduit-http-e2e", version: "0.8.0-test" },
        },
      }),
    });
    assert.equal(initialize.status, 200);
    const initializeBody = await readMcpResponse(initialize);
    const initializeResult = initializeBody.result as { serverInfo?: { name?: string } } | undefined;
    assert.equal(initializeResult?.serverInfo?.name, SERVICE_NAME);

    const tools = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    assert.equal(tools.status, 200);
    const toolsBody = await readMcpResponse(tools);
    const toolsResult = toolsBody.result as { tools?: Array<{ name: string }> } | undefined;
    assert.ok(toolsResult?.tools?.some((tool) => tool.name === "agent_identity"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("black-box MCP HTTP authentication path challenges then accepts a test verifier", async () => {
  await init();
  const serverHolder: { app?: ReturnType<typeof createConduitApp> } = {};
  const server = createServer((req, res) => serverHolder.app!(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const authConfig = testAuthConfig(`${baseUrl}/mcp`);
    serverHolder.app = createConduitApp({
      authConfig,
      tokenVerifier: {
        async verifyAccessToken(token: string): Promise<AuthInfo> {
          if (token !== "test-access-token") throw new Error("invalid_token");
          return {
            token,
            clientId: "test-client",
            scopes: ["mcp:conduit.read", "mcp:conduit.write"],
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            extra: { sub: "test-subject" },
          };
        },
      },
    });

    const unauthenticated = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "conduit-http-e2e", version: "0.8.0-test" },
        },
      }),
    });
    assert.equal(unauthenticated.status, 401);
    const challenge = unauthenticated.headers.get("www-authenticate") ?? "";
    assert.match(challenge, /Bearer/i);
    assert.match(challenge, /resource_metadata/i);

    const ready = await fetch(`${baseUrl}/ready`);
    assert.equal(ready.status, 200);
    const readyBody = await ready.json() as { status: string; version: string; persistence: string; contractRevision: string };
    assert.equal(readyBody.status, "ready");
    assert.equal(readyBody.persistence, "memory");
    assert.equal(typeof readyBody.contractRevision, "string");
    assert.equal(readyBody.contractRevision.length > 0, true);

    const initialize = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { ...mcpHeaders(), Authorization: "Bearer test-access-token" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "conduit-http-e2e", version: "0.8.0-test" },
        },
      }),
    });
    assert.equal(initialize.status, 200);
    const initializeBody = await readMcpResponse(initialize);
    const initializeResult = initializeBody.result as { serverInfo?: { name?: string } } | undefined;
    assert.equal(initializeResult?.serverInfo?.name, SERVICE_NAME);

    const tools = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { ...mcpHeaders(), Authorization: "Bearer test-access-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }),
    });
    assert.equal(tools.status, 200);
    const toolsBody = await readMcpResponse(tools);
    const toolsResult = toolsBody.result as { tools?: Array<{ name: string }> } | undefined;
    assert.ok(toolsResult?.tools?.some((tool) => tool.name === "agent_identity"));

    const call = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { ...mcpHeaders(), Authorization: "Bearer test-access-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "agent_identity", arguments: {} } }),
    });
    assert.equal(call.status, 200);
    const callBody = await readMcpResponse(call);
    assert.ok(callBody.result);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("GET /diagnostics returns JSON without secrets", async () => {
  await init();
  const app = createConduitApp({ anonymous: true });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${baseUrl}/diagnostics`);
    assert.equal(response.status, 200);
    const body = await response.json() as {
      resource: string;
      checks: Record<string, { ok: boolean }>;
      scopeParity: { ok: boolean };
      discovery: { cimd: boolean; dcr: boolean };
    };
    assert.equal(typeof body.resource, "string");
    assert.equal(body.checks.health.ok, true);
    assert.equal(typeof body.scopeParity.ok, "boolean");
    assert.equal(typeof body.discovery.cimd, "boolean");
    const serialized = JSON.stringify(body).toLowerCase();
    assert.equal(serialized.includes("bearer "), false);
    assert.equal(serialized.includes("password"), false);
    assert.equal(serialized.includes("client_secret"), false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

function rawGet(port: number, path: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET", headers: { Host: host } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("GET /diagnostics rejects a Host header pointing at another port", async () => {
  await init();
  DIAGNOSTICS_RATE_LIMITER.clear();
  const app = createConduitApp({ anonymous: true });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await rawGet(address.port, "/diagnostics", "127.0.0.1:6379");
    assert.equal(response.status, 400);
    assert.match(response.body, /diagnostics_target_not_allowed/);
  } finally {
    DIAGNOSTICS_RATE_LIMITER.clear();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("GET /diagnostics is rate limited", async () => {
  await init();
  DIAGNOSTICS_RATE_LIMITER.clear();
  const app = createConduitApp({ anonymous: true });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    // Exhaust the budget with cheap rejected-target calls (the limiter runs first).
    let lastStatus = 0;
    for (let i = 0; i < 11; i += 1) lastStatus = (await rawGet(address.port, "/diagnostics", "127.0.0.1:1")).status;
    assert.equal(lastStatus, 429);
  } finally {
    DIAGNOSTICS_RATE_LIMITER.clear();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("task_get enforces an explicit project context", async () => {
  await init();
  await registerAgent({ id: "task-scope-agent", name: "Task Scope Agent" });
  const projectA = await createProject({ name: "Task scope A", createdBy: "task-scope-agent" });
  const projectB = await createProject({ name: "Task scope B", createdBy: "task-scope-agent" });
  assert.ok(projectA && projectB);
  const task = await createTask({ title: "Scoped task", createdBy: "task-scope-agent", projectId: projectA.id });
  assert.ok(task);

  const app = createConduitApp({ anonymous: true });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const callTaskGet = async (args: Record<string, unknown>, id: number) => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: mcpHeaders(),
        body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "task_get", arguments: args } }),
      });
      assert.equal(response.status, 200);
      return (await readMcpResponse(response)).result as { isError?: boolean; structuredContent?: { id?: string } };
    };

    const unscoped = await callTaskGet({ taskId: task.id }, 1);
    assert.notEqual(unscoped.isError, true);
    assert.equal(unscoped.structuredContent?.id, task.id);

    const sameProject = await callTaskGet({ taskId: task.id, projectId: projectA.id }, 2);
    assert.notEqual(sameProject.isError, true);
    assert.equal(sameProject.structuredContent?.id, task.id);

    const otherProject = await callTaskGet({ taskId: task.id, projectId: projectB.id }, 3);
    assert.equal(otherProject.isError, true);
    assert.equal(otherProject.structuredContent?.id, undefined);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
