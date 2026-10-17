import express, { type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { getOAuthProtectedResourceMetadataUrl, hostHeaderValidation, mcpAuthMetadataRouter, originValidation, requireBearerAuth } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { createConduitServer } from "./mcp.js";
import { buildProtectedResourceMetadata, createDevelopmentAuthInfo, createTokenVerifier, DEVELOPMENT_ANONYMOUS_SUBJECT, DEVELOPMENT_TOKEN_SUBJECT, requireScope, type ConduitAuthConfig } from "./auth.js";
import { SERVICE_NAME } from "./version.js";
import { healthBody, readyBody } from "./health-contract.js";
import { MCP_RATE_LIMITER, TOOL_RATE_LIMITER } from "./rate-limit.js";
import { getPublicConduitStatus } from "./status.js";
import { checkPersistence } from "./db-ready.js";
import { isReady } from "./store.js";
import { createDiagnosticsHandler } from "./diagnostics-route.js";
import { replayRecentEvents, subscribeEvents } from "./events.js";
import { conduitUiHtml, CONDUIT_UI_CSS, CONDUIT_UI_JS } from "./ui.js";
import { isDevelopmentRuntime } from "./runtime.js";

/**
 * Single source of HTTP wiring. `index.ts` builds options from the environment with
 * `conduitAppOptionsFromEnv()` and calls this; tests call it directly, so they exercise
 * the same middleware, routes, and auth modes production runs.
 */
export interface ConduitAppOptions {
  /** OAuth (production) mode. Takes precedence over every development mode. */
  authConfig?: ConduitAuthConfig;
  tokenVerifier?: OAuthTokenVerifier;
  /** Development static bearer token. Callers must only set this when isDevelopmentRuntime(). */
  devToken?: string;
  /** Development anonymous mode. Callers must only set this when isDevelopmentRuntime(). */
  anonymous?: boolean;
  /** Host header allow-list. Omit to skip host validation (tests). */
  allowedHostnames?: string[];
  /** Allowed browser origins (absolute URLs, already normalised to origins). Empty = CORS "*". */
  allowedOrigins?: string[];
  /** Express "trust proxy" value. */
  trustProxy?: number | false;
  /** Pass-through options for the MCP handler (tests may request stateless legacy mode). */
  mcpHandlerOptions?: Parameters<typeof createMcpHandler>[1];
  /** Emit X-Request-Id on responses. */
  requestIds?: boolean;
  /** Logger for the auth-mode banner (defaults to console). */
  log?: Pick<Console, "log" | "warn" | "error">;
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy": "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
};
const ALLOWED_CORS_HEADERS = "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Mcp-Method, Mcp-Name";

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

export function timingSafeTokenMatch(expected: string, supplied: string | undefined) {
  if (!supplied) return false;
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(supplied, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

const bearer = (req: Request) => req.header("authorization")?.replace(/^Bearer\s+/i, "");

/** Build app options from the environment exactly as production does. Dev modes are fenced by isDevelopmentRuntime(). */
export function conduitAppOptionsFromEnv(env: NodeJS.ProcessEnv, authConfig: ConduitAuthConfig | null, trustProxy?: number | false): ConduitAppOptions {
  const allowedOrigins = env.MCP_ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean).map((origin) => {
    try { return new URL(origin).origin; } catch { throw new Error(`MCP_ALLOWED_ORIGINS contains an invalid absolute URL: ${origin}`); }
  }) ?? [];
  const allowedHostnames = new Set<string>(["localhost", "127.0.0.1", "[::1]"]);
  const publicUrl = env.PUBLIC_URL?.trim();
  if (publicUrl) {
    try { allowedHostnames.add(new URL(publicUrl).hostname); } catch { throw new Error("PUBLIC_URL must be a valid absolute URL"); }
  }
  const dev = isDevelopmentRuntime(env);
  return {
    authConfig: authConfig ?? undefined,
    devToken: dev && env.CONDUIT_TOKEN ? env.CONDUIT_TOKEN : undefined,
    anonymous: dev && env.CONDUIT_ALLOW_ANONYMOUS === "true",
    allowedHostnames: [...allowedHostnames],
    allowedOrigins: [...new Set(allowedOrigins)],
    trustProxy,
  };
}

export function createConduitApp(options: ConduitAppOptions = {}) {
  const log = options.log ?? console;
  const app = express();
  app.disable("x-powered-by");
  if (options.trustProxy !== undefined) app.set("trust proxy", options.trustProxy);
  app.use((req, res, next) => {
    res.set(SECURITY_HEADERS);
    if (options.requestIds) res.set("X-Request-Id", req.get("x-request-id")?.slice(0, 80) || crypto.randomUUID());
    next();
  });
  app.use(express.json({ limit: process.env.MAX_JSON_BODY || "1mb" }));

  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  if (options.allowedHostnames) app.use(hostHeaderValidation(options.allowedHostnames));
  const allowedOriginHostnames = [...allowedOrigins].map((origin) => new URL(origin).hostname);
  if (allowedOriginHostnames.length) app.use(originValidation(allowedOriginHostnames));
  app.use((req, res, next) => {
    const requestOrigin = req.header("origin");
    if (allowedOrigins.size > 0) {
      if (requestOrigin && allowedOrigins.has(requestOrigin)) { res.set("Access-Control-Allow-Origin", requestOrigin); res.set("Vary", "Origin"); }
    } else res.set("Access-Control-Allow-Origin", "*");
    res.set({ "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": ALLOWED_CORS_HEADERS, "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Session-Id" });
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  app.get("/", (_req, res) => res.type("html").send(conduitUiHtml()));
  app.get("/ui.css", (_req, res) => res.type("css").send(CONDUIT_UI_CSS));
  app.get("/ui.js", (_req, res) => res.type("application/javascript").send(CONDUIT_UI_JS));
  app.get("/status", async (_req, res, next) => { try { res.json(await getPublicConduitStatus()); } catch (error) { next(error); } });
  app.get("/health", (_req, res) => res.json(healthBody()));
  app.get("/ready", async (_req, res) => {
    const initialized = isReady();
    const persistenceOk = initialized ? await checkPersistence() : false;
    const persistence = process.env.DATABASE_URL && process.env.CONDUIT_TEST_MEMORY !== "true" ? "postgres" : "memory";
    const body = readyBody({ initialized, persistenceOk, persistence });
    res.status(body.status === "ready" ? 200 : 503).json(body);
  });
  app.get("/diagnostics", createDiagnosticsHandler(options.authConfig));

  const authConfig = options.authConfig;
  const tokenVerifier = authConfig ? options.tokenVerifier ?? createTokenVerifier(authConfig) : undefined;

  // /events: Server-Sent Events task lifecycle stream.
  const eventHandler = async (req: Request, res: Response) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const seen = new Set<string>();
    let open = true;
    const emit = (event: Record<string, string>) => { if (!open || seen.has(event.id)) return; seen.add(event.id); if (seen.size > 200) seen.delete(seen.values().next().value as string); res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); };
    // Admission happens BEFORE the 200/headers are flushed: at the subscriber cap the
    // client gets an honest 503 + Retry-After instead of a hung 200 stream and an
    // unhandled rejection from the async handler.
    let unsubscribe: () => unknown;
    try { unsubscribe = subscribeEvents({ projectId }, emit); }
    catch { res.status(503).set("Retry-After", "5").json({ error: "event_subscriber_limit_reached" }); return; }
    // Declared before cleanup (which closes over them) and assigned once the stream is open.
    // eslint-disable-next-line prefer-const
    let poll: ReturnType<typeof setInterval> | undefined;
    // eslint-disable-next-line prefer-const
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => { if (!open) return; open = false; clearInterval(poll); clearInterval(heartbeat); unsubscribe(); };
    req.on("close", cleanup);
    res.status(200);
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders?.();
    try { for (const event of await replayRecentEvents(projectId)) emit(event); } catch { /* replay is best-effort; live events still flow */ }
    if (!open) return;
    poll = setInterval(async () => { try { for (const event of await replayRecentEvents(projectId)) emit(event); } catch { /* connection remains alive */ } }, 2000);
    heartbeat = setInterval(() => { if (open) res.write(`: heartbeat ${Date.now()}\n\n`); }, 15000);
  };
  const eventAuth = authConfig
    ? async (req: Request, res: Response, next: NextFunction) => {
        const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(authConfig.resourceUrl)).toString();
        const token = bearer(req);
        if (!token) { unauthorizedBearer(res, resourceMetadataUrl); return; }
        try {
          const authInfo = await tokenVerifier!.verifyAccessToken(token);
          requireScope(authInfo, authConfig.readScope);
          req.auth = authInfo;
          next();
        } catch { unauthorizedBearer(res, resourceMetadataUrl); }
      }
    : (req: Request, res: Response, next: NextFunction) => {
        if (options.devToken) {
          if (!timingSafeTokenMatch(options.devToken, bearer(req))) { unauthorizedBearer(res); return; }
          req.auth = createDevelopmentAuthInfo(DEVELOPMENT_TOKEN_SUBJECT, options.devToken); next(); return;
        }
        if (options.anonymous) { req.auth = createDevelopmentAuthInfo(DEVELOPMENT_ANONYMOUS_SUBJECT, "anonymous"); next(); return; }
        res.status(503).json({ error: "auth_not_configured" });
      };
  app.get("/events", eventAuth, rateLimitMcp, eventHandler);

  // /mcp: exactly one auth mode, OAuth first.
  if (authConfig) {
    const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(authConfig.resourceUrl)).toString();
    const protectedResourceMetadata = buildProtectedResourceMetadata(authConfig);
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) app.get(path, (_req, res) => { res.type("application/json").json(protectedResourceMetadata); });
    app.use(mcpAuthMetadataRouter({ oauthMetadata: authConfig.metadata, resourceServerUrl: new URL(authConfig.resourceUrl) }));
    const nodeHandler = toNodeHandler(createMcpHandler(() => createConduitServer(authConfig), options.mcpHandlerOptions), { onerror: console.error });
    app.all("/mcp", requireBearerAuth({ verifier: tokenVerifier!, resourceMetadataUrl }), rateLimitMcp, (req, res) => nodeHandler(req, res, req.body));
    log.log(`Conduit OAuth enabled for ${authConfig.resourceUrl}`);
  } else if (options.devToken) {
    const token = options.devToken;
    const nodeHandler = toNodeHandler(createMcpHandler(() => createConduitServer(), options.mcpHandlerOptions), { onerror: console.error });
    app.all("/mcp", (req, res, next) => { if (!timingSafeTokenMatch(token, bearer(req))) { unauthorizedBearer(res); return; } req.auth = createDevelopmentAuthInfo(DEVELOPMENT_TOKEN_SUBJECT, token); next(); }, rateLimitMcp, (req, res) => nodeHandler(req, res, req.body));
    log.log("Conduit development bearer-token mode enabled");
  } else if (options.anonymous) {
    const nodeHandler = toNodeHandler(createMcpHandler(() => createConduitServer(), options.mcpHandlerOptions), { onerror: console.error });
    app.all("/mcp", (req, _res, next) => { req.auth = createDevelopmentAuthInfo(DEVELOPMENT_ANONYMOUS_SUBJECT, "anonymous"); next(); }, rateLimitMcp, (req, res) => nodeHandler(req, res, req.body));
    log.warn("Conduit anonymous MCP mode is enabled for development only");
  } else {
    app.all("/mcp", (_req, res) => res.status(503).json({ error: "auth_not_configured", message: "Configure DESCOPE_MCP_SERVER_WELL_KNOWN_URL in production" }));
    log.error("No MCP OAuth authentication configured; /mcp is disabled");
  }

  return app;
}
