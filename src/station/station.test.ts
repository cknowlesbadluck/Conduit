import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { init } from "../store.js";
import { initCapabilityStore, createCapabilityGrant } from "../capability-store.js";
import { registerAgent, createTask, createProject } from "../store.js";
import { registerStationRoutes } from "./routes.js";
import { loadStationSnapshot } from "./data.js";
import { createDevelopmentAuthInfo, DEVELOPMENT_TOKEN_SUBJECT } from "../auth.js";

describe("station monitor", () => {
  before(async () => {
    process.env.CONDUIT_TEST_MEMORY = "true";
    await init();
    await initCapabilityStore();
  });

  it("loadStationSnapshot returns tasks and scoped grants", async () => {
    const agent = await registerAgent({ id: "station-agent", name: "Station Agent", actorSubject: DEVELOPMENT_TOKEN_SUBJECT });
    assert.ok(agent);
    const project = await createProject({ name: "Station Project", createdBy: "station-agent" });
    assert.ok(project);
    const task = await createTask({ title: "Station task", createdBy: "station-agent", projectId: project!.id });
    assert.ok(task);
    await createCapabilityGrant({
      agentId: "station-agent",
      projectId: project!.id,
      provider: "github",
      method: "GET",
      pathPattern: "/repos/*",
      createdBy: "station-agent",
    });

    const auth = createDevelopmentAuthInfo(DEVELOPMENT_TOKEN_SUBJECT, "test-token");
    const snapshot = await loadStationSnapshot(auth, project!.id);
    assert.ok(snapshot.tasks.some((t) => t.id === task!.id));
    assert.ok(snapshot.grants.some((g) => g.agentId === "station-agent" && g.provider === "github"));
    assert.equal(snapshot.projectId, project!.id);
  });

  it("GET /station requires auth middleware (401 when middleware rejects)", async () => {
    const app = express();
    registerStationRoutes(app, (_req, res) => {
      res.status(401).json({ error: "unauthorized" });
    });
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/station`);
      assert.equal(res.status, 401);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("GET /station returns HTML when authorized", async () => {
    const app = express();
    registerStationRoutes(app, (req, _res, next) => {
      req.auth = createDevelopmentAuthInfo(DEVELOPMENT_TOKEN_SUBJECT, "test-token");
      next();
    });
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/station`);
      assert.equal(res.status, 200);
      const contentType = res.headers.get("content-type") ?? "";
      assert.ok(contentType.includes("text/html"));
      const body = await res.text();
      assert.ok(body.includes("Station"));
      assert.ok(body.includes("Tasks"));
      assert.ok(body.includes("Grants"));
      assert.ok(!body.includes("<script>"));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("GET /station?format=json returns snapshot JSON", async () => {
    const app = express();
    registerStationRoutes(app, (req, _res, next) => {
      req.auth = createDevelopmentAuthInfo(DEVELOPMENT_TOKEN_SUBJECT, "test-token");
      next();
    });
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/station?format=json`);
      assert.equal(res.status, 200);
      const data = (await res.json()) as { tasks: unknown[]; grants: unknown[]; generatedAt: string };
      assert.ok(Array.isArray(data.tasks));
      assert.ok(Array.isArray(data.grants));
      assert.ok(typeof data.generatedAt === "string");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
