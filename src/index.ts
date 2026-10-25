import { init } from "./store.js";
import { initCapabilityStore } from "./capability-store.js";
import { createTokenVerifier, loadAuthConfig } from "./auth.js";
import { VERSION, SERVICE_NAME } from "./version.js";
import { healthBody } from "./health-contract.js";
import { replayRecentEvents, subscribeEvents } from "./events.js";
import { createEventStreamHandler } from "./sse.js";
import { conduitUiHtml, CONDUIT_UI_CSS, CONDUIT_UI_JS } from "./ui.js";
import { createConduitApp } from "./app-factory.js";

// Production boots through createConduitApp() so the HTTP surface the tests exercise is the one that ships.
// Fail-closed gating stays here: the static dev token and anonymous mode are never enabled when NODE_ENV=production
// (process.env.CONDUIT_TOKEN && process.env.NODE_ENV !== "production"); with no OAuth config /mcp answers 503 auth_not_configured.
function parseAllowedOrigins() {
  return process.env.MCP_ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean).map((origin) => { try { return new URL(origin).origin; } catch { throw new Error(`MCP_ALLOWED_ORIGINS contains an invalid absolute URL: ${origin}`); } }) ?? [];
}
function allowedHostnames() {
  const hostnames = new Set<string>(["localhost", "127.0.0.1", "[::1]"]);
  const publicUrl = process.env.PUBLIC_URL?.trim();
  if (publicUrl) { try { hostnames.add(new URL(publicUrl).hostname); } catch { throw new Error("PUBLIC_URL must be a valid absolute URL"); } }
  return [...hostnames];
}

async function boot() {
  // Validate env-derived config before touching storage (same throw-on-invalid behaviour as before).
  const allowedOrigins = parseAllowedOrigins();
  const hostnames = allowedHostnames();
  const port = Number(process.env.PORT || 3000);
  const allowAnonymous = process.env.CONDUIT_ALLOW_ANONYMOUS === "true" && process.env.NODE_ENV !== "production";
  const devToken = process.env.CONDUIT_TOKEN && process.env.NODE_ENV !== "production" ? process.env.CONDUIT_TOKEN : undefined;
  await init();
  await initCapabilityStore();
  const authConfig = await loadAuthConfig();
  // One verifier (and cached remote JWKS) shared by /events and /mcp.
  const tokenVerifier = authConfig ? createTokenVerifier(authConfig) : undefined;
  const app = createConduitApp({
    authConfig: authConfig ?? undefined,
    tokenVerifier,
    devToken,
    anonymous: allowAnonymous,
    allowedHostnames: hostnames,
    allowedOrigins,
    cors: true,
    eventsHandler: createEventStreamHandler({ replay: replayRecentEvents, subscribe: subscribeEvents }),
    legacyStateless: false,
  });
  if (authConfig) console.log(`Conduit OAuth enabled for ${authConfig.resourceUrl}`);
  else if (devToken) console.log("Conduit development bearer-token mode enabled");
  else if (allowAnonymous) console.warn("Conduit anonymous MCP mode is enabled for development only");
  else console.error("No MCP OAuth authentication configured; /mcp is disabled");
  const server = app.listen(port, "0.0.0.0", () => console.log(`Conduit listening on ${port}`));
  const shutdown = async () => { server.close(); process.exit(0); };
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
}

if (typeof process !== "undefined" && process.versions?.node && !process.env.CLOUDFLARE_WORKER) {
  boot().catch((error) => { console.error("Conduit startup failed", error); process.exit(1); });
}

const workersUnsupported = () => new Response(JSON.stringify({ status: "not_supported", service: SERVICE_NAME, version: VERSION, reason: "workers_runtime_unsupported", detail: "Conduit requires the Node.js server (npm start); this Workers entrypoint serves static UI and liveness only." }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

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
  // Cloudflare Workers cannot run Conduit's Node/Express/Postgres stack. Report that honestly instead of
  // serving fabricated readiness or zero counts.
  if (url.pathname === "/status" || url.pathname === "/ready" || url.pathname === "/diagnostics" || url.pathname === "/mcp" || url.pathname === "/events") {
    return workersUnsupported();
  }
  if (url.pathname === "/health") {
    return new Response(JSON.stringify(healthBody()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ service: SERVICE_NAME, version: VERSION, status: "workers_static_only", runtime: "cloudflare-workers", mcp: "not_supported", health: "/health" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export default { fetch: fetchHandler };
