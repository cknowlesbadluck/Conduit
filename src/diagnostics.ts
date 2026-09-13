import type { ConduitAuthConfig } from "./auth.js";

export type ConduitDiagnostics = {
  resource: string;
  checks: Record<string, { ok: boolean; status?: number; detail?: string }>;
  scopeParity: { ok: boolean; configured: string[]; advertised: string[]; missing: string[] };
  discovery: { cimd: boolean; dcr: boolean };
};

const safeFetch = async (url: string) => {
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
    return { ok: response.ok, status: response.status, response };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "fetch_failed" };
  }
};

export function buildDiagnosticsFromMetadata(input: {
  resource: string;
  scopesSupported: string[];
  configuredScopes: string[];
  clientIdMetadataSupported?: boolean;
  registrationEndpoint?: string;
}) {
  const missing = input.configuredScopes.filter((scope) => !input.scopesSupported.includes(scope));
  return {
    resource: input.resource,
    checks: {},
    scopeParity: { ok: missing.length === 0, configured: input.configuredScopes, advertised: input.scopesSupported, missing },
    discovery: { cimd: input.clientIdMetadataSupported === true, dcr: typeof input.registrationEndpoint === "string" && input.registrationEndpoint.length > 0 },
  } satisfies ConduitDiagnostics;
}

export async function runDiagnostics(authConfig?: ConduitAuthConfig, baseUrl?: string): Promise<ConduitDiagnostics> {
  const resource = authConfig?.resourceUrl ?? `${process.env.PUBLIC_URL ?? "http://localhost:3000"}/mcp`;
  const configuredBase = baseUrl ?? new URL(resource).origin;
  const expectedOrigin = new URL(resource).origin;
  if (new URL(configuredBase).origin !== expectedOrigin) throw new Error("diagnostics_target_must_match_conduit_origin");

  const checks: ConduitDiagnostics["checks"] = {};
  const health = await safeFetch(`${configuredBase}/health`);
  checks.health = { ok: health.ok, status: health.status, ...(health.detail ? { detail: health.detail } : {}) };

  const rootPrm = await safeFetch(`${configuredBase}/.well-known/oauth-protected-resource`);
  const pathPrm = await safeFetch(`${configuredBase}/.well-known/oauth-protected-resource/mcp`);
  checks.protectedResourceRoot = { ok: rootPrm.ok, status: rootPrm.status };
  checks.protectedResourcePath = { ok: pathPrm.ok, status: pathPrm.status };

  const configuredScopes = authConfig ? [authConfig.readScope, authConfig.writeScope] : [];
  let advertisedScopes: string[] = [];
  if (rootPrm.ok) {
    try {
      const metadata = await rootPrm.response!.json() as { scopes_supported?: unknown };
      if (Array.isArray(metadata.scopes_supported)) advertisedScopes = metadata.scopes_supported.filter((value): value is string => typeof value === "string");
    } catch { checks.protectedResourceRoot.detail = "invalid_json"; }
  }

  const metadata = buildDiagnosticsFromMetadata({
    resource,
    scopesSupported: advertisedScopes,
    configuredScopes,
    clientIdMetadataSupported: authConfig?.metadata.client_id_metadata_document_supported,
    registrationEndpoint: authConfig?.metadata.registration_endpoint,
  });
  Object.assign(checks, metadata.checks);

  if (authConfig) {
    const discovery = await safeFetch(authConfig.discoveryUrl);
    checks.authorizationServer = { ok: discovery.ok, status: discovery.status };
    const jwks = await safeFetch(authConfig.metadata.jwks_uri);
    checks.jwks = { ok: jwks.ok, status: jwks.status };
    checks.issuer = { ok: true, detail: new URL(authConfig.issuer).origin };
  } else {
    checks.authorizationServer = { ok: false, detail: "oauth_not_configured" };
    checks.jwks = { ok: false, detail: "oauth_not_configured" };
    checks.issuer = { ok: false, detail: "oauth_not_configured" };
  }

  return { ...metadata, checks };
}
