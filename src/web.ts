import type { Express, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";

const cookieName = "conduit_session";
const domain = () => process.env.WORKOS_AUTHKIT_DOMAIN?.trim();
const clientId = () => process.env.WORKOS_AUTHKIT_CLIENT_ID?.trim();
const publicUrl = () => (process.env.PUBLIC_URL?.trim() || "").replace(/\/$/, "");
const secret = () => process.env.CONDUIT_SESSION_SECRET?.trim();

function parseCookies(req: Request) {
  const header = req.header("cookie") || "";
  return Object.fromEntries(header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function redirectUri() { return `${publicUrl()}/auth/callback`; }

async function stateToken(payload: Record<string, unknown>) {
  const key = secret();
  if (!key) throw new Error("CONDUIT_SESSION_SECRET is required for the human interface");
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(key));
}

async function verifyState(token: string) {
  const key = secret();
  if (!key) throw new Error("CONDUIT_SESSION_SECRET is required for the human interface");
  return (await jwtVerify(token, new TextEncoder().encode(key), { algorithms: ["HS256"] })).payload;
}

function authkitBase() {
  const value = domain();
  if (!value) throw new Error("WORKOS_AUTHKIT_DOMAIN is required for the human interface");
  return value.replace(/\/$/, "").startsWith("http") ? value.replace(/\/$/, "") : `https://${value.replace(/\/$/, "")}`;
}

async function exchangeCode(code: string, verifier: string) {
  const response = await fetch(`${authkitBase()}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId() || "", redirect_uri: redirectUri(), code_verifier: verifier }).toString(),
  });
  if (!response.ok) throw new Error(`WorkOS token exchange failed: HTTP ${response.status}`);
  return await response.json() as { access_token: string; refresh_token?: string; expires_in?: number };
}

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Conduit</title><style>body{margin:0;background:#0b0d12;color:#e8edf7;font:16px system-ui,sans-serif}main{max-width:900px;margin:0 auto;padding:48px 22px}a,button{color:#fff;background:#26344f;border:1px solid #405173;border-radius:10px;padding:12px 16px;text-decoration:none;cursor:pointer}h1{font-size:34px}section{background:#121722;border:1px solid #273146;border-radius:16px;padding:22px;margin:18px 0}code{background:#090c12;padding:3px 6px;border-radius:6px}.muted{color:#9ca8bc}.danger{background:#3b2027}</style></head><body><main>${body}</main></body></html>`;
}

export function registerWebRoutes(app: Express) {
  app.get("/", (_req, res) => {
    res.type("html").send(page("Conduit", `<h1>Conduit</h1><p class="muted">Human control surface for the shared agent workspace.</p><section><h2>Machine interface</h2><p>MCP endpoint: <code>/mcp</code></p><p>Events: <code>/events</code></p></section><section><a href="/login">Sign in with WorkOS</a></section>`));
  });

  app.get("/login", async (_req, res) => {
    try {
      const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
      const verifier = Buffer.from(verifierBytes).toString("base64url");
      const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", verifierBytes)).toString("base64url");
      const state = await stateToken({ verifier });
      const url = new URL(`${authkitBase()}/oauth2/authorize`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", clientId() || "");
      url.searchParams.set("redirect_uri", redirectUri());
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("state", state);
      url.searchParams.set("scope", "openid profile email");
      res.redirect(url.toString());
    } catch (error) { res.status(503).type("html").send(page("Configuration required", `<h1>Human sign-in is not configured</h1><p>${error instanceof Error ? error.message : "configuration_error"}</p>`)); }
  });

  app.get("/auth/callback", async (req, res) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      if (!code || !state) throw new Error("Missing authorization response");
      const payload = await verifyState(state);
      const verifier = typeof payload.verifier === "string" ? payload.verifier : "";
      if (!verifier) throw new Error("Invalid authorization state");
      const tokens = await exchangeCode(code, verifier);
      const maxAge = Math.max(300, Math.min(2592000, Number(tokens.expires_in || 3600)));
      res.setHeader("Set-Cookie", `${cookieName}=${encodeURIComponent(tokens.access_token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
      res.redirect("/dashboard");
    } catch (error) { res.status(401).type("html").send(page("Sign-in failed", `<h1>Sign-in failed</h1><p>${error instanceof Error ? error.message : "authentication_error"}</p><p><a href="/">Return to Conduit</a></p>`)); }
  });

  app.get("/logout", (_req, res) => {
    res.setHeader("Set-Cookie", `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    res.redirect("/");
  });

  app.get("/dashboard", async (req, res) => {
    const token = parseCookies(req)[cookieName];
    if (!token) { res.redirect("/login"); return; }
    const d = domain();
    if (!d) { res.redirect("/login"); return; }
    try {
      const jwks = createRemoteJWKSet(new URL(`${authkitBase()}/oauth2/jwks`));
      const { payload } = await jwtVerify(token, jwks, { issuer: authkitBase() });
      const name = typeof payload.name === "string" ? payload.name : "Authenticated user";
      const email = typeof payload.email === "string" ? payload.email : "";
      res.type("html").send(page("Dashboard", `<h1>Conduit</h1><p class="muted">Signed in as ${escapeHtml(name)}${email ? ` · ${escapeHtml(email)}` : ""}</p><section><h2>Workspace</h2><p>Human identity is verified through WorkOS AuthKit.</p><p>Agent coordination remains available through MCP at <code>/mcp</code>.</p></section><section><h2>Control boundary</h2><p>External integrations remain deny-by-default and are governed through Conduit capability grants. Human approval is the control boundary for consequential access.</p></section><section><a class="danger" href="/logout">Sign out</a></section>`));
    } catch { res.setHeader("Set-Cookie", `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`); res.redirect("/login"); }
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] || character);
}
