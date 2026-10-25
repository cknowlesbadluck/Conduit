import express, { type NextFunction, type Request, type Response } from "express";
import { resolveRequestId } from "./request-id.js";
import { getOAuthProtectedResourceMetadataUrl, hostHeaderValidation, mcpAuthMetadataRouter, originValidation, requireBearerAuth } from "@modelcontextprotocol/express";
import { timingSafeEqual } from "node:crypto";
import { SERVICE_NAME } from "./version.js";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createConduitServer } from "./mcp.js";
import { buildProtectedResourceMetadata, createDevelopmentAuthInfo, createTokenVerifier, DEVELOPMENT_ANONYMOUS_SUBJECT, DEVELOPMENT_TOKEN_SUBJECT, requireScope, type ConduitAuthConfig } from "./auth.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { healthBody, readyBody } from "./health-contract.js";
import { MCP_RATE_LIMITER, TOOL_RATE_LIMITER } from "./rate-limit.js";
import { getPublicConduitStatus } from "./status.js";
import { checkPersistence } from "./db-ready.js";
import { isReady } from "./store.js";
import { createDiagnosticsHandler } from "./diagnostics-route.js";
import { conduitUiHtml, CONDUIT_UI_CSS, CONDUIT_UI_JS } from "./ui.js";

export interface ConduitAppOptions {
  anonymous?: boolean;
  authConfig?: ConduitAuthConfig;
  tokenVerifier?: OAuthTokenVerifier;
  /** Development-only static bearer token. Callers must never pass this in production (index.ts gates on NODE_ENV). */
  devToken?: string;
  /** Host-header allowlist (DNS-rebinding protection). Omitted = no host validation (tests). */
  allowedHostnames?: string[];
  /** Absolute origins allowed for CORS + origin validation. Empty/omitted = `Access-Control-Allow-Origin: *`. */
  allowedOrigins?: string[];
  /** Apply CORS headers and answer OPTIONS preflight with 204 (production behaviour). */
  cors?: boolean;
  /** SSE handler mounted at GET /events behind the same auth mode as /mcp. */
  eventsHandler?: (req: Request, res: Response) => unknown;
  /** Use the MCP SDK's legacy stateless transport. Defaults to true (historical factory behaviour); index.ts passes false to keep production's transport. */
  legacyStateless?: boolean;
}

const ALLOWED_CORS_HEADERS = "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Mcp-Method, Mcp-Name";

function timingSafeTokenMatch(expected: string, supplied: string | undefined) {
  if (!supplied) return false;
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(supplied, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function unauthorizedBearer(res: Response, metadataUrl?: string) {
  const resourceMetadata = metadataUrl ? `, resource_metadata="${metadataUrl}"` : "";
  res.set("WWW-Authenticate", `Bearer realm="${SERVICE_NAME}", error="invalid_token"${resourceMetadata}`);
  res.status(401).json({ error: "unauthorized" });
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

export function createConduitApp(options: ConduitAppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    const requestId = resolveRequestId(_req.get("x-request-id"));
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
      "X-Request-Id": requestId,
      "Content-Security-Policy": "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.json({ limit: process.env.MAX_JSON_BODY || "1mb" }));
  if (options.allowedHostnames) app.use(hostHeaderValidation(options.allowedHostnames));
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const allowedOriginHostnames = [...allowedOrigins].map((origin) => new URL(origin).hostname);
  if (allowedOriginHostnames.length) app.use(originValidation(allowedOriginHostnames));
  if (options.cors) {
    app.use((req, res, next) => {
      const requestOrigin = req.header("origin");
      if (allowedOrigins.size > 0) {
        if (requestOrigin && allowedOrigins.has(requestOrigin)) { res.set("Access-Control-Allow-Origin", requestOrigin); res.set("Vary", "Origin"); }
      } else res.set("Access-Control-Allow-Origin", "*");
      res.set({ "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": ALLOWED_CORS_HEADERS, "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Session-Id" });
      if (req.method === "OPTIONS") { res.sendStatus(204); return; }
      next();
    });
  }
  const mcpHandlerOptions = options.legacyStateless === false ? undefined : ({ legacy: "stateless" } as const);
  const verifier = options.authConfig ? (options.tokenVerifier ?? createTokenVerifier(options.authConfig)) : undefined;

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
  app.get("/health", (_req, res) => res.json(healthBody()));

  app.get("/diagnostics", createDiagnosticsHandler(options.authConfig));

  app.get("/ready", async (_req, res) => {
    const initialized = isReady();
    const persistenceOk = initialized ? await checkPersistence() : false;
    const persistence = process.env.DATABASE_URL && process.env.CONDUIT_TEST_MEMORY !== "true" ? "postgres" : "memory";
    const body = readyBody({ initialized, persistenceOk, persistence });
    res.status(body.status === "ready" ? 200 : 503).json(body);
  });

  if (options.eventsHandler) {
    const eventsHandler = options.eventsHandler;
    const authConfig = options.authConfig;
    const eventAuth = authConfig
      ? async (req: Request, res: Response, next: NextFunction) => {
          const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(authConfig.resourceUrl)).toString();
          const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
          if (!token) { unauthorizedBearer(res, resourceMetadataUrl); return; }
          try {
            const authInfo = await verifier!.verifyAccessToken(token);
            requireScope(authInfo, authConfig.readScope);
            req.auth = authInfo;
            next();
          } catch { unauthorizedBearer(res, resourceMetadataUrl); }
        }
      : (req: Request, res: Response, next: NextFunction) => {
          if (options.devToken) {
            const supplied = req.header("authorization")?.replace(/^Bearer\s+/i, "");
            if (!timingSafeTokenMatch(options.devToken, supplied)) { unauthorizedBearer(res); return; }
            req.auth = createDevelopmentAuthInfo(DEVELOPMENT_TOKEN_SUBJECT, options.devToken); next(); return;
          }
          if (options.anonymous) { req.auth = createDevelopmentAuthInfo(DEVELOPMENT_ANONYMOUS_SUBJECT, "anonymous"); next(); return; }
          res.status(503).json({ error: "auth_not_configured" });
        };
    app.get("/events", eventAuth, rateLimitMcp, (req, res) => { void eventsHandler(req, res); });
  }

  if (options.authConfig) {
    const authConfig = options.authConfig;
    const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(authConfig.resourceUrl)).toString();
    const protectedResourceMetadata = buildProtectedResourceMetadata(authConfig);
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) app.get(path, (_req, res) => res.type("application/json").json(protectedResourceMetadata));
    app.use(mcpAuthMetadataRouter({ oauthMetadata: authConfig.metadata, resourceServerUrl: new URL(authConfig.resourceUrl) }));
    const handler = createMcpHandler(() => createConduitServer(authConfig), mcpHandlerOptions);
    const nodeHandler = toNodeHandler(handler, { onerror: console.error });
    app.all("/mcp", requireBearerAuth({ verifier: verifier!, resourceMetadataUrl }), rateLimitMcp, (req, res) => nodeHandler(req, res, req.body));
  } else if (options.devToken) {
    const token = options.devToken;
    const handler = createMcpHandler(() => createConduitServer(), mcpHandlerOptions);
    const nodeHandler = toNodeHandler(handler, { onerror: console.error });
    app.all("/mcp", (req, res, next) => {
      const supplied = req.header("authorization")?.replace(/^Bearer\s+/i, "");
      if (!timingSafeTokenMatch(token, supplied)) { unauthorizedBearer(res); return; }
      req.auth = createDevelopmentAuthInfo(DEVELOPMENT_TOKEN_SUBJECT, token);
      next();
    }, rateLimitMcp, (req, res) => nodeHandler(req, res, req.body));
  } else if (options.anonymous) {
    const handler = createMcpHandler(() => createConduitServer(), mcpHandlerOptions);
    const nodeHandler = toNodeHandler(handler, { onerror: console.error });
    app.all("/mcp", (req, _res, next) => {
      req.auth = createDevelopmentAuthInfo(DEVELOPMENT_ANONYMOUS_SUBJECT, "anonymous");
      next();
    }, rateLimitMcp, (req, res) => nodeHandler(req, res, req.body));
  } else {
    app.all("/mcp", (_req, res) => res.status(503).json({ error: "auth_not_configured", message: "Configure DESCOPE_MCP_SERVER_WELL_KNOWN_URL in production" }));
  }

  return app;
}
