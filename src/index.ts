import { init } from "./store.js";
import { initCapabilityStore } from "./capability-store.js";
import { loadAuthConfig } from "./auth.js";
import { VERSION, SERVICE_NAME } from "./version.js";
import { healthBody, readyBody } from "./health-contract.js";
import { runDiagnostics } from "./diagnostics.js";
import { conduitUiHtml, CONDUIT_UI_CSS, CONDUIT_UI_JS } from "./ui.js";
import { conduitAppOptionsFromEnv, createConduitApp } from "./app-factory.js";

/** Production entrypoint: all HTTP wiring lives in app-factory.ts (covered by tests). */
async function boot() {
  await init();
  await initCapabilityStore();
  const authConfig = await loadAuthConfig();
  const app = createConduitApp(conduitAppOptionsFromEnv(process.env, authConfig));
  const port = Number(process.env.PORT || 3000);
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
  if (url.pathname === "/diagnostics") {
    const diagnostics = await runDiagnostics(undefined, url.origin);
    return new Response(JSON.stringify(diagnostics), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  if (url.pathname === "/health") {
    return new Response(JSON.stringify(healthBody()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.pathname === "/ready") {
    return new Response(JSON.stringify(readyBody({ initialized: true, persistenceOk: true, persistence: "memory" })), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ service: SERVICE_NAME, version: VERSION, status: "online", mcp: "/mcp", health: "/health", ready: "/ready", events: "/events" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export default { fetch: fetchHandler };
