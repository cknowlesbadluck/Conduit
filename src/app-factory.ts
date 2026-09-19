import express, { type NextFunction, type Request, type Response } from "express";
import { getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter, requireBearerAuth } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createConduitServer } from "./mcp.js";
import { buildProtectedResourceMetadata, createDevelopmentAuthInfo, createTokenVerifier, DEVELOPMENT_ANONYMOUS_SUBJECT, type ConduitAuthConfig } from "./auth.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { VERSION, SERVICE_NAME } from "./version.js";
import { MCP_RATE_LIMITER, TOOL_RATE_LIMITER } from "./rate-limit.js";
import { getPublicConduitStatus } from "./status.js";
import { checkPersistence } from "./db-ready.js";
import { isReady } from "./store.js";
import { conduitUiHtml, CONDUIT_UI_CSS, CONDUIT_UI_JS } from "./ui.js";
import { migrateRenderDatabaseToNeon } from "./migrate-render-to-neon.js";

export interface ConduitAppOptions {
  anonymous?: boolean;
  authConfig?: ConduitAuthConfig;
  tokenVerifier?: OAuthTokenVerifier;
}

function rateLimitMcp(req: Request, res: Response, next: NextFunction) {
  const authInfo = req.auth;
  const actor = authInfo?.extra?.sub || authInfo?.clientId || req.ip || "anonymous";
  const general = MCP_RATE_LIMITER.check(`mcp:${actor}`);
  const toolName = req.body?.method === "tools/call" && typeof req.body?.params?.name === "string" ? req.body.params.name : null;
  const tool = toolName ? TOOL_RATE_LIMITER.check(`tool:${actor}:${toolName}`) : { allowed: true, retryAfterMs: 0 };
  const result = !general.allowed ? general : tool;
  if (!result.allowed) {
    res.set("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
    res.status(429).json({ error: "rate_limited", retryAfterMs: result.retryAfterMs });
    return;
  }
  next();
}

function unauthorizedBearer(res: Response, metadataUrl?: string) {
  const resourceMetadata = metadataUrl ? `, resource_metadata="${metadataUrl}"` : "";
  res.set("WWW-Authenticate", `Bearer realm="${SERVICE_NAME}", error="invalid_token"${resourceMetadata}`);
  res.status(401).json({ error: "unauthorized" });
}

export function createConduitApp(options: ConduitAppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.json({ limit: process.env.MAX_JSON_BODY || "1mb" }));

  app.get("/", (_req, res) => res.type("html").send(conduitUiHtml()));
  app.get("/ui.css", (_req, res) => res.type("css").send(CONDUIT_UI_CSS));
  app.get("/ui.js", (_req, res) => res.type("application/javascript").send(CONDUIT_UI_JS));
  app.get("/status", async (_req, res, next) => {
    try {
      res.json(await getPublicConduitStatus());
    } catch (error) {
      next(error);
    }
  });
  app.get("/health", (_req, res) => res.json({ status: "ok", service: "conduit" }));

  if (process.env.MIGRATION_SECRET) {
    const runMigration = async (req: Request, res: Response, next: NextFunction) => {
      const supplied = req.get("x-conduit-migration-secret") || req.query.token;
      if (supplied !== process.env.MIGRATION_SECRET) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      try {
        res.json(await migrateRenderDatabaseToNeon());
      } catch (error) {
        next(error);
      }
    });
  }
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

  if (options.authConfig) {
    const authConfig = options.authConfig;
    const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(authConfig.resourceUrl)).toString();
    app.use(mcpAuthMetadataRouter({ oauthMetadata: authConfig.metadata, resourceServerUrl: new URL(authConfig.resourceUrl) }));
    app.get("/.well-known/oauth-protected-resource", (_req, res) => res.json(buildProtectedResourceMetadata(authConfig)));
    app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => res.json(buildProtectedResourceMetadata(authConfig)));
    const handler = createMcpHandler(() => createConduitServer(authConfig), { legacy: "stateless" });
    const nodeHandler = toNodeHandler(handler, { onerror: console.error });
    const verifier = options.tokenVerifier ?? createTokenVerifier(authConfig);
    app.all("/mcp", requireBearerAuth({ verifier, resourceMetadataUrl }), rateLimitMcp, (req, res) => nodeHandler(req, res, req.body));
  } else if (options.anonymous) {
    const handler = createMcpHandler(() => createConduitServer(), { legacy: "stateless" });
    const nodeHandler = toNodeHandler(handler, { onerror: console.error });
    app.all("/mcp", (req, _res, next) => {
      req.auth = createDevelopmentAuthInfo(DEVELOPMENT_ANONYMOUS_SUBJECT, "anonymous");
      next();
    }, rateLimitMcp, (req, res) => nodeHandler(req, res, req.body));
  } else {
    app.all("/mcp", (_req, res) => res.status(503).json({ error: "auth_not_configured" }));
  }

  return app;
}
