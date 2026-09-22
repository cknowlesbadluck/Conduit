import express from "express";
import { getOAuthProtectedResourceMetadataUrl, hostHeaderValidation, mcpAuthMetadataRouter, originValidation, requireBearerAuth } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { init, isReady } from "./store.js";
import { checkPersistence } from "./db-ready.js";
import { initCapabilityStore } from "./capability-store.js";
import { buildProtectedResourceMetadata, createDevelopmentAuthInfo, createTokenVerifier, DEVELOPMENT_ANONYMOUS_SUBJECT, DEVELOPMENT_TOKEN_SUBJECT, loadAuthConfig, requireScope } from "./auth.js";
import { createConduitServer } from "./mcp.js";
import { VERSION, SERVICE_NAME } from "./version.js";
import { MCP_RATE_LIMITER, TOOL_RATE_LIMITER } from "./rate-limit.js";
import { timingSafeEqual } from "node:crypto";
import { replayRecentEvents, subscribeEvents } from "./events.js";
import { getPublicConduitStatus } from "./status.js";
import { conduitUiHtml, CONDUIT_UI_CSS, CONDUIT_UI_JS } from "./ui.js";

const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
  next();
});
app.use(express.json({ limit: process.env.MAX_JSON_BODY || "1mb" }));
const configuredOrigins = process.env.MCP_ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean).map((origin) => { try { return new URL(origin).origin; } catch { throw new Error(`MCP_ALLOWED_ORIGINS contains an invalid absolute URL: ${origin}`); } });
const allowedOrigins = new Set(configuredOrigins || []);
const allowedOriginHostnames = [...allowedOrigins].map((origin) => new URL(origin).hostname);
const allowedCorsHeaders = "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Mcp-Method, Mcp-Name";
function applyCors(req: express.Request, res: express.Response) { const requestOrigin = req.header("origin"); if (allowedOrigins.size > 0) { if (requestOrigin && allowedOrigins.has(requestOrigin)) { res.set("Access-Control-Allow-Origin", requestOrigin); res.set("Vary", "Origin"); } } else res.set("Access-Control-Allow-Origin", "*"); res.set({ "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": allowedCorsHeaders, "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Session-Id" }); }
const publicUrl = process.env.PUBLIC_URL?.trim();
const allowedHostnames = new Set<string>(["localhost", "127.0.0.1", "[::1]"]);
if (publicUrl) { try { allowedHostnames.add(new URL(publicUrl).hostname); } catch { throw new Error("PUBLIC_URL must be a valid absolute URL"); } }
app.use(hostHeaderValidation([...allowedHostnames]));
if (allowedOriginHostnames.length) app.use(originValidation(allowedOriginHostnames));
app.use((req, res, next) => { applyCors(req, res); if (req.method === "OPTIONS") { res.sendStatus(204); return; } next(); });
const port = Number(process.env.PORT || 3000);
const allowAnonymous = process.env.CONDUIT_ALLOW_ANONYMOUS === "true" && process.env.NODE_ENV !== "production";
function protectedResourceMetadataResponse(res: express.Response, metadata: ReturnType<typeof buildProtectedResourceMetadata>) { res.type("application/json").json(metadata); }
function unauthorizedBearer(res: express.Response, metadataUrl?: string) { const resourceMetadata = metadataUrl ? `, resource_metadata="${metadataUrl}"` : ""; res.set("WWW-Authenticate", `Bearer realm="${SERVICE_NAME}", error="invalid_token"${resourceMetadata}`); res.status(401).json({ error: "unauthorized" }); }
function timingSafeTokenMatch(expected: string, supplied: string | undefined) { if (!supplied) return false; const left = Buffer.from(expected, "utf8"); const right = Buffer.from(supplied, "utf8"); return left.length === right.length && timingSafeEqual(left, right); }
function rateLimitMcp(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authInfo = req.auth;
  const actor = authInfo?.extra?.sub || authInfo?.clientId || req.ip || "anonymous";
  const general = MCP_RATE_LIMITER.check(`mcp:${actor}`);
  const toolName = req.body?.method === "tools/call" && typeof req.body?.params?.name === "string" ? req.body.params.name : null;
  const tool = toolName ? TOOL_RATE_LIMITER.check(`tool:${actor}:${toolName}`) : { allowed: true, retryAfterMs: 0 };
  const result = !general.allowed ? general : tool;
  if (!result.allowed) { res.set("Retry-After", String(Math.ceil(result.retryAfterMs / 1000))); res.status(429).json({ error: "rate_limited", retryAfterMs: result.retryAfterMs }); return; }
  next();
}

app.get("/", (_req, res) => res.type("html").send(conduitUiHtml()));
app.get("/ui.css", (_req, res) => res.type("css").send(CONDUIT_UI_CSS));
app.get("/ui.js", (_req, res) => res.type("application/javascript").send(CONDUIT_UI_JS));
app.get("/status", async (_req, res, next) => { try { res.json(await getPublicConduitStatus()); } catch (error) { next(error); } });
app.get("/health", (_req, res) => res.json({ status: "ok", service: "conduit" }));
app.get("/ready", async (_req, res) => {
  const initialized = isReady();
  const persistenceOk = initialized ? await checkPersistence() : false;
  const ready = initialized && persistenceOk;
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : (initialized ? "degraded" : "initializing"),
    service: "conduit",
    version: VERSION,
    persistence: process.env.DATABASE_URL && process.env.CONDUIT_TEST_MEMORY !== "true" ? "postgres" : "memory",
  });
});

async function boot() {
  await init();
  await initCapabilityStore();
  const authConfig = await loadAuthConfig();
  const eventHandler = async (req: express.Request, res: express.Response) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    res.status(200);
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders?.();
    const seen = new Set<string>();
    const emit = (event: Record<string, string>) => { if (seen.has(event.id)) return; seen.add(event.id); if (seen.size > 200) seen.delete(seen.values().next().value as string); res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); };
    for (const event of await replayRecentEvents(projectId)) emit(event);
    const unsubscribe = subscribeEvents({ projectId }, emit);
    const poll = setInterval(async () => { try { for (const event of await replayRecentEvents(projectId)) emit(event); } catch { /* connection remains alive */ } }, 2000);
    const heartbeat = setInterval(() => res.write(`: heartbeat ${Date.now()}\n\n`), 15000);
    const cleanup = () => { clearInterval(poll); clearInterval(heartbeat); unsubscribe(); };
    req.on("close", cleanup);
  };
  const eventAuthMiddleware = authConfig
    ? async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(authConfig.resourceUrl)).toString();
        const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
        if (!token) { unauthorizedBearer(res, resourceMetadataUrl); return; }
        try {
          const authInfo = await createTokenVerifier(authConfig).verifyAccessToken(token);
          requireScope(authInfo, authConfig.readScope);
          req.auth = authInfo;
          next();
        } catch { unauthorizedBearer(res, resourceMetadataUrl); }
      }
    : (req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (process.env.CONDUIT_TOKEN && process.env.NODE_ENV !== "production") {
          const supplied = req.header("authorization")?.replace(/^Bearer\s+/i, "");
          if (!timingSafeTokenMatch(process.env.CONDUIT_TOKEN, supplied)) { unauthorizedBearer(res); return; }
          req.auth = createDevelopmentAuthInfo(DEVELOPMENT_TOKEN_SUBJECT, process.env.CONDUIT_TOKEN); next(); return;
        }
        if (allowAnonymous) { req.auth = createDevelopmentAuthInfo(DEVELOPMENT_ANONYMOUS_SUBJECT, "anonymous"); next(); return; }
        res.status(503).json({ error: "auth_not_configured" });
      };
  app.get("/events", eventAuthMiddleware, rateLimitMcp, eventHandler);

  if (authConfig) {
    const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(authConfig.resourceUrl)).toString();
    const protectedResourceMetadata = buildProtectedResourceMetadata(authConfig);
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) app.get(path, (_req, res) => protectedResourceMetadataResponse(res, protectedResourceMetadata));
    app.use(mcpAuthMetadataRouter({ oauthMetadata: authConfig.metadata, resourceServerUrl: new URL(authConfig.resourceUrl) }));
    const handler = createMcpHandler(() => createConduitServer(authConfig));
    const nodeHandler = toNodeHandler(handler, { onerror: console.error });
    app.all("/mcp", requireBearerAuth({ verifier: createTokenVerifier(authConfig), resourceMetadataUrl }), rateLimitMcp, (req, res) => nodeHandler(req, res, req.body));
    console.log(`Conduit OAuth enabled for ${authConfig.resourceUrl}`);
  } else if (process.env.CONDUIT_TOKEN && process.env.NODE_ENV !== "production") {
    const token = process.env.CONDUIT_TOKEN;
    const handler = createMcpHandler(() => createConduitServer());
    const nodeHandler = toNodeHandler(handler, { onerror: console.error });
    app.all("/mcp", (req, res, next) => { const supplied = req.header("authorization")?.replace(/^Bearer\s+/i, ""); if (!timingSafeTokenMatch(token, supplied)) { unauthorizedBearer(res); return; } req.auth = createDevelopmentAuthInfo(DEVELOPMENT_TOKEN_SUBJECT, token); next(); }, rateLimitMcp, (req, res) => nodeHandler(req, res, req.body));
    console.log("Conduit development bearer-token mode enabled");
  } else if (allowAnonymous) {
    const handler = createMcpHandler(() => createConduitServer());
    const nodeHandler = toNodeHandler(handler, { onerror: console.error });
    app.all("/mcp", (req, _res, next) => { req.auth = createDevelopmentAuthInfo(DEVELOPMENT_ANONYMOUS_SUBJECT, "anonymous"); next(); }, rateLimitMcp, (req, res) => nodeHandler(req, res, req.body));
    console.warn("Conduit anonymous MCP mode is enabled for development only");
  } else {
    app.all("/mcp", (_req, res) => res.status(503).json({ error: "auth_not_configured", message: "Configure DESCOPE_MCP_SERVER_WELL_KNOWN_URL in production" }));
    console.error("No MCP OAuth authentication configured; /mcp is disabled");
  }
  const server = app.listen(port, "0.0.0.0", () => console.log(`Conduit listening on ${port}`));
  const shutdown = async () => { server.close(); process.exit(0); };
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
}

if (typeof process !== "undefined" && process.versions?.node && !process.env.CLOUDFLARE_WORKER) {
  boot().catch((error) => { console.error("Conduit startup failed", error); process.exit(1); });
}

export const fetchHandler = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  if (url.pathname === "/") {
    return new Response(conduitUiHtml(), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" } });
  }
  if (url.pathname === "/ui.css") {
    return new Response(CONDUIT_UI_CSS, { status: 200, headers: { "Content-Type": "text/css; charset=utf-8" } });
  }
  if (url.pathname === "/ui.js") {
    return new Response(CONDUIT_UI_JS, { status: 200, headers: { "Content-Type": "application/javascript; charset=utf-8" } });
  }
  if (url.pathname === "/status") {
    return new Response(JSON.stringify({ service: SERVICE_NAME, version: VERSION, status: "online", connections: [], tools: [], tasks: [], activity: [], counts: { agents: 0, connected: 0, tools: 0, tasks: 0, activity: 0 } }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  if (url.pathname === "/health") {
    return new Response(JSON.stringify({ status: "ok", service: "conduit" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.pathname === "/ready") {
    return new Response(JSON.stringify({ status: "ready", service: "conduit", version: VERSION, persistence: "memory" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ service: SERVICE_NAME, version: VERSION, status: "online", mcp: "/mcp", health: "/health", ready: "/ready", events: "/events" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export default {
  fetch: fetchHandler,
};
