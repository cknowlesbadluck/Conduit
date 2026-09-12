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

const configuredOrigins = process.env.MCP_ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean).map((origin) => {
  try {
    return new URL(origin).origin;
  } catch {
    throw new Error(`MCP_ALLOWED_ORIGINS contains an invalid absolute URL: ${origin}`);
  }
});
const allowedOrigins = new Set(configuredOrigins || []);
const allowedOriginHostnames = [...allowedOrigins].map((origin) => new URL(origin).hostname);

function applyCors(req: express.Request, res: express.Response) {
  const requestOrigin = req.header("origin");
  if (allowedOrigins.size > 0) {
    if (requestOrigin && allowedOrigins.has(requestOrigin)) {
      res.set("Access-Control-Allow-Origin", requestOrigin);
      res.set("Vary", "Origin");
    }
  } else {
    res.set("Access-Control-Allow-Origin", "*");
  }
  res.set({
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": requestOrigin ? (req.header("access-control-request-headers") || "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id") : "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id",
    "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Session-Id",
  });
}

// Remote MCP hosts run in browsers as well as native clients. Bearer tokens
// are supplied explicitly rather than by cookies, so cross-origin discovery
// and authenticated requests must be permitted for OAuth/CIMD to complete.
app.use((req, res, next) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

const publicUrl = process.env.PUBLIC_URL?.trim();
const allowedHostnames = new Set<string>(["localhost", "127.0.0.1", "[::1]"]);
if (publicUrl) { try { allowedHostnames.add(new URL(publicUrl).hostname); } catch { throw new Error("PUBLIC_URL must be a valid absolute URL"); } }
app.use(hostHeaderValidation([...allowedHostnames]));
if (allowedOriginHostnames.length) app.use(originValidation(allowedOriginHostnames));

const port = Number(process.env.PORT || 3000);
const allowAnonymous = process.env.CONDUIT_ALLOW_ANONYMOUS === "true" && process.env.NODE_ENV !== "production";

/**
 * OAuth discovery is commonly fetched by browser-based MCP hosts. Keep the
 * hand-authored protected-resource documents as accessible as the SDK's
 * authorization-server metadata route, including for preflight requests.
 */
function protectedResourceMetadataResponse(req: express.Request, res: express.Response, metadata: ReturnType<typeof buildProtectedResourceMetadata>) {
  applyCors(req, res);
  res.type("application/json").json(metadata);
}

app.get("/", (_req, res) => res.json({ service: "Conduit", version: "0.6.0", status: "online", mcp: "/mcp", health: "/health", ready: "/ready" }));
app.get("/health", (_req, res) => res.json({ status: "ok", service: "conduit" }));
app.get("/ready", (_req, res) => res.status(isReady() ? 200 : 503).json({ status: isReady() ? "ready" : "initializing", service: "conduit" }));

async function boot() {
  await init();
  const authConfig = await loadAuthConfig();
  if (authConfig) {
    const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(authConfig.resourceUrl)).toString();
    const protectedResourceMetadata = buildProtectedResourceMetadata(authConfig);
    // Serve identical full RFC 9728 documents at both the root and path-specific well-known
    // locations. Clients follow the 401 WWW-Authenticate resource_metadata pointer to the
    // path-specific URL; mcpAuthMetadataRouter alone serves a thinner document there.
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      app.get(path, (req, res) => protectedResourceMetadataResponse(req, res, protectedResourceMetadata));
    }
    // Still mount the SDK router for Authorization Server metadata mirroring.
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
  const server = app.listen(port, "0.0.0.0", () => console.log(`Conduit listening on ${port}`));
  const shutdown = async () => { server.close(); process.exit(0); };
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
}

boot().catch((error) => { console.error("Conduit startup failed", error); process.exit(1); });

export default app;
