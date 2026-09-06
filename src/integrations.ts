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

const definitions: Record<IntegrationProvider, Omit<IntegrationDefinition, "configured">> = {
  github: { provider: "github", description: "GitHub REST API through a Conduit-managed bearer credential.", baseUrl: "https://api.github.com", credentialEnv: "GITHUB_TOKEN", readMethods: ["GET", "HEAD"], writeMethods: ["POST", "PUT", "PATCH", "DELETE"] },
  render: { provider: "render", description: "Render API through a Conduit-managed API key.", baseUrl: "https://api.render.com", credentialEnv: "RENDER_API_KEY", readMethods: ["GET", "HEAD"], writeMethods: ["POST", "PUT", "PATCH", "DELETE"] },
  supabase: { provider: "supabase", description: "Supabase Management API through a Conduit-managed access token.", baseUrl: "https://api.supabase.com", credentialEnv: "SUPABASE_ACCESS_TOKEN", readMethods: ["GET", "HEAD"], writeMethods: ["POST", "PUT", "PATCH", "DELETE"] },
};

export function listIntegrations(): IntegrationDefinition[] {
  return Object.values(definitions).map((definition) => ({ ...definition, configured: Boolean(process.env[definition.credentialEnv]) }));
}

function normalizePath(path: string) {
  const value = path.trim();
  if (!value.startsWith("/")) throw new Error("integration_path_must_start_with_slash");
  if (value.includes("\\")) throw new Error("integration_path_invalid");
  const url = new URL(value, "https://conduit.invalid");
  if (url.origin !== "https://conduit.invalid") throw new Error("integration_path_must_be_relative");
  return `${url.pathname}${url.search}`;
}

function authHeaders(provider: IntegrationProvider, token: string): Record<string, string> {
  if (provider === "github") return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  return { Authorization: `Bearer ${token}` };
}

function parseResponse(text: string, contentType: string | null): unknown {
  if (!text) return null;
  if (contentType?.includes("application/json")) {
    try { return JSON.parse(text); } catch { return text; }
  }
  try { return JSON.parse(text); } catch { return text; }
}

export async function callIntegration(input: { provider: IntegrationProvider; method: IntegrationMethod; path: string; body?: unknown }): Promise<IntegrationResult> {
  const definition = definitions[input.provider];
  const token = process.env[definition.credentialEnv];
  if (!token) throw new Error(`integration_not_configured:${input.provider}`);
  const path = normalizePath(input.path);
  const headers: Record<string, string> = { ...authHeaders(input.provider, token), "User-Agent": "Conduit/0.6.0" };
  const init: RequestInit = { method: input.method, headers };
  if (input.body !== undefined && input.method !== "GET" && input.method !== "HEAD") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(input.body);
  }
  const response = await fetch(`${definition.baseUrl}${path}`, init);
  const text = await response.text();
  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of response.headers.entries()) {
    if (["content-type", "etag", "location", "x-ratelimit-remaining", "x-ratelimit-reset"].includes(key.toLowerCase())) responseHeaders[key] = value;
  }
  return { provider: input.provider, method: input.method, path, status: response.status, ok: response.ok, headers: responseHeaders, data: parseResponse(text, response.headers.get("content-type")) };
}

export const integrationProviders = ["github", "render", "supabase"] as const;
export const integrationMethods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
