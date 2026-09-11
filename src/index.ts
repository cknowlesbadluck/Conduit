import express from "express";
import { getOAuthProtectedResourceMetadataUrl, hostHeaderValidation, mcpAuthMetadataRouter, originValidation, requireBearerAuth } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { init, isReady } from "./store.js";
import { buildProtectedResourceMetadata, createTokenVerifier, loadAuthConfig } from "./auth.js";
import { createConduitServer } from "./mcp.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: process.env.MAX_JSON_BODY || "1mb" }));

const publicUrl = process.env.PUBLIC_URL?.trim();
const allowedHostnames = new Set<string>(["localhost", "127.0.0.1", "[::1]"]);
if (publicUrl) { try { allowedHostnames.add(new URL(publicUrl).hostname); } catch { throw new Error("PUBLIC_URL must be a valid absolute URL"); } }
app.use(hostHeaderValidation([...allowedHostnames]));
app.use(originValidation([...allowedHostnames]));

const port = Number(process.env.PORT || 3000);
const allowAnonymous = process.env.CONDUIT_ALLOW_ANONYMOUS === "true" && process.env.NODE_ENV !== "production";

app.get("/", (_req, res) => res.json({ service: "Conduit", version: "0.6.0", status: "online", mcp: "/mcp", health: "/health", ready: "/ready" }));
app.get("/health", (_req, res) => res.json({ status: "ok", service: "conduit" }));
app.get("/ready", (_req, res) => res.status(isReady() ? 200 : 503).json({ status: isReady() ? "ready" : "initializing", service: "conduit" }));

async function boot() {
  await init();
  const authConfig = await loadAuthConfig();
  if (authConfig) {
    const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(authConfig.resourceUrl)).toString();
    app.get("/.well-known/oauth-protected-resource", (_req, res) => res.type("application/json").json(buildProtectedResourceMetadata(authConfig)));
    app.use(mcpAuthMetadataRouter({ oauthMetadata: authConfig.metadata, resourceServerUrl: new URL(authConfig.resourceUrl) }));
    const handler = createMcpHandler(() => createConduitServer(authConfig));
    app.all("/mcp", requireBearerAuth({ verifier: createTokenVerifier(authConfig), resourceMetadataUrl }), toNodeHandler(handler, { onerror: console.error }));
    console.log(`Conduit OAuth enabled for ${authConfig.resourceUrl}`);
  } else if (process.env.CONDUIT_TOKEN) {
    const token = process.env.CONDUIT_TOKEN;
    const handler = createMcpHandler(() => createConduitServer());
    app.all("/mcp", (req, res, next) => { if (req.header("authorization") !== `Bearer ${token}`) { res.status(401).json({ error: "unauthorized" }); return; } next(); }, toNodeHandler(handler, { onerror: console.error }));
    console.log("Conduit private bearer-token mode enabled");
  } else if (allowAnonymous) {
    const handler = createMcpHandler(() => createConduitServer());
    app.all("/mcp", toNodeHandler(handler, { onerror: console.error }));
    console.warn("Conduit anonymous MCP mode is enabled for development only");
  } else {
    app.all("/mcp", (_req, res) => res.status(503).json({ error: "auth_not_configured", message: "Configure DESCOPE_MCP_SERVER_WELL_KNOWN_URL or CONDUIT_TOKEN" }));
    console.error("No MCP authentication configured; /mcp is disabled");
  }

  if (process.env.NODE_ENV !== "test" && !process.env.CF_PAGES && !process.env.WORKER) {
    const server = app.listen(port, "0.0.0.0", () => console.log(`Conduit listening on ${port}`));
    const shutdown = async () => { server.close(); process.exit(0); };
    process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
  }
}

let bootPromise: Promise<void> | null = null;
function ensureBoot() {
  if (!bootPromise) bootPromise = boot();
  return bootPromise;
}

if (process.env.NODE_ENV !== "test") {
  ensureBoot().catch((error) => { console.error("Conduit startup failed", error); process.exit(1); });
}

type ExpressWithFetch = express.Express & { fetch: (request: Request) => Promise<Response> };
(app as ExpressWithFetch).fetch = async (request: Request) => {
  await ensureBoot();
  const { IncomingMessage, ServerResponse } = await import("node:http");
  const { Socket } = await import("node:net");
  return new Promise((resolve) => {
    const url = new URL(request.url);
    const socket = new Socket();
    const req = new IncomingMessage(socket);
    req.method = request.method;
    req.url = url.pathname + url.search;
    req.headers = Object.fromEntries(request.headers.entries());

    const res = new ServerResponse(req);
    const chunks: Buffer[] = [];
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);

    res.write = ((chunk: any, encoding?: any, cb?: any) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      return origWrite(chunk, encoding, cb);
    }) as any;

    res.end = ((chunk?: any, encoding?: any, cb?: any) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [k, v] of Object.entries(res.getHeaders())) {
        if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
      }
      resolve(new Response(body, { status: res.statusCode, headers }));
      return origEnd(chunk, encoding, cb);
    }) as any;

    if (request.body) {
      request.arrayBuffer().then((buf) => {
        req.push(Buffer.from(buf));
        req.push(null);
        app(req, res);
      }).catch(() => {
        req.push(null);
        app(req, res);
      });
    } else {
      req.push(null);
      app(req, res);
    }
  });
};

export default app;
