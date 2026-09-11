export type IntegrationProvider = "github" | "render" | "supabase";
export type IntegrationMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

export type IntegrationDefinition = {
  provider: IntegrationProvider;
  description: string;
  baseUrl: string;
  credentialEnv: string;
  configured: boolean;
  readMethods: IntegrationMethod[];
  writeMethods: IntegrationMethod[];
};

export type IntegrationResult = {
  provider: IntegrationProvider;
  method: IntegrationMethod;
  path: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  data: unknown;
};

const MAX_PATH_LENGTH = 2000;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const BASE_URL = "https://conduit.invalid";
// Optimization: Reuse a static TextEncoder instance to avoid repeated object allocations on every request byte check.
const textEncoder = new TextEncoder();

const definitions: Record<IntegrationProvider, Omit<IntegrationDefinition, "configured">> = {
  github: { provider: "github", description: "GitHub REST API through a Conduit-managed bearer credential.", baseUrl: "https://api.github.com", credentialEnv: "GITHUB_TOKEN", readMethods: ["GET", "HEAD"], writeMethods: ["POST", "PUT", "PATCH", "DELETE"] },
  render: { provider: "render", description: "Render API through a Conduit-managed API key.", baseUrl: "https://api.render.com", credentialEnv: "RENDER_API_KEY", readMethods: ["GET", "HEAD"], writeMethods: ["POST", "PUT", "PATCH", "DELETE"] },
  supabase: { provider: "supabase", description: "Supabase Management API through a Conduit-managed access token.", baseUrl: "https://api.supabase.com", credentialEnv: "SUPABASE_ACCESS_TOKEN", readMethods: ["GET", "HEAD"], writeMethods: ["POST", "PUT", "PATCH", "DELETE"] },
};

export function listIntegrations(): IntegrationDefinition[] {
  return Object.values(definitions).map((definition) => ({ ...definition, configured: Boolean(process.env[definition.credentialEnv]) }));
}

function normalizePath(path: string): string {
  const value = path.trim();
  if (value.length === 0 || value.length > MAX_PATH_LENGTH) throw new Error("integration_path_invalid");
  if (!value.startsWith("/")) throw new Error("integration_path_must_start_with_slash");
  if (value.startsWith("//") || value.includes("\\") || /^(?:\/|%2f)?\.\.?(?:\/|%2f)/i.test(value)) throw new Error("integration_path_invalid");
  let url: URL;
  try { url = new URL(value, BASE_URL); } catch { throw new Error("integration_path_invalid"); }
  if (url.origin !== BASE_URL || url.username || url.password || url.protocol !== "https:") throw new Error("integration_path_must_be_relative");
  const decodedPath = decodeURIComponent(url.pathname);
  if (decodedPath.split("/").some((segment) => segment === ".." || segment === ".")) throw new Error("integration_path_invalid");
  return `${url.pathname}${url.search}`;
}

function authHeaders(provider: IntegrationProvider, token: string): Record<string, string> {
  if (provider === "github") return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  return { Authorization: `Bearer ${token}` };
}

async function readLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("integration_response_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("integration_response_too_large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function parseResponse(text: string): unknown {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export async function callIntegration(input: { provider: IntegrationProvider; method: IntegrationMethod; path: string; body?: unknown }): Promise<IntegrationResult> {
  const definition = definitions[input.provider];
  const token = process.env[definition.credentialEnv];
  if (!token) throw new Error(`integration_not_configured:${input.provider}`);
  const path = normalizePath(input.path);
  const headers: Record<string, string> = { ...authHeaders(input.provider, token), "User-Agent": "Conduit/0.6.0" };
  const init: RequestInit = { method: input.method, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
  if (input.body !== undefined && input.method !== "GET" && input.method !== "HEAD") {
    let serialized: string;
    try { serialized = JSON.stringify(input.body); } catch { throw new Error("integration_request_invalid_json"); }
    if (textEncoder.encode(serialized).byteLength > MAX_REQUEST_BYTES) throw new Error("integration_request_too_large");
    headers["Content-Type"] = "application/json";
    init.body = serialized;
  }
  let response: Response;
  try {
    response = await fetch(`${definition.baseUrl}${path}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") throw new Error("integration_timeout");
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("integration_timeout");
    throw new Error("integration_network_failed");
  }
  const text = await readLimited(response);
  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of response.headers.entries()) {
    const normalized = key.toLowerCase();
    if (["content-type", "etag", "location", "x-ratelimit-remaining", "x-ratelimit-reset"].includes(normalized)) responseHeaders[key] = value;
  }
  return { provider: input.provider, method: input.method, path, status: response.status, ok: response.ok, headers: responseHeaders, data: parseResponse(text) };
}

export const integrationProviders = ["github", "render", "supabase"] as const;
export const integrationMethods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
