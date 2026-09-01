import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";

type OAuthMetadata = {
  issuer: string;
  jwks_uri: string;
  authorization_endpoint: string;
  token_endpoint: string;
  response_types_supported: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
  scopes_supported?: string[];
  client_id_metadata_document_supported?: boolean;
  registration_endpoint?: string;
  [key: string]: unknown;
};

export type ConduitAuthConfig = {
  enabled: boolean;
  issuer: string;
  discoveryUrl: string;
  resourceUrl: string;
  metadata: OAuthMetadata;
  readScope: string;
  writeScope: string;
};

const requiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when OAuth authentication is enabled`);
  return value;
};

export async function loadAuthConfig(): Promise<ConduitAuthConfig | null> {
  const discoveryUrl = process.env.DESCOPE_MCP_SERVER_WELL_KNOWN_URL?.trim();
  if (!discoveryUrl) return null;

  const resourceUrl = process.env.MCP_RESOURCE_URL?.trim() || `${requiredEnv("PUBLIC_URL").replace(/\/$/, "")}/mcp`;
  const response = await fetch(discoveryUrl, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Unable to load Descope discovery metadata: HTTP ${response.status}`);

  const raw = (await response.json()) as Record<string, unknown>;
  const issuer = typeof raw.issuer === "string" ? raw.issuer : "";
  const jwksUri = typeof raw.jwks_uri === "string" ? raw.jwks_uri : "";
  const authorizationEndpoint = typeof raw.authorization_endpoint === "string" ? raw.authorization_endpoint : "";
  const tokenEndpoint = typeof raw.token_endpoint === "string" ? raw.token_endpoint : "";
  if (!issuer || !jwksUri || !authorizationEndpoint || !tokenEndpoint) {
    throw new Error("Descope discovery metadata is missing issuer, jwks_uri, authorization_endpoint, or token_endpoint");
  }

  const configuredIssuer = process.env.DESCOPE_MCP_SERVER_ISSUER?.trim();
  if (configuredIssuer && configuredIssuer !== issuer) {
    throw new Error("DESCOPE_MCP_SERVER_ISSUER does not match the issuer returned by discovery");
  }

  const metadata: OAuthMetadata = {
    ...raw,
    issuer,
    jwks_uri: jwksUri,
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
    response_types_supported: Array.isArray(raw.response_types_supported) && raw.response_types_supported.every((v) => typeof v === "string")
      ? raw.response_types_supported as string[]
      : ["code"],
  };

  return {
    enabled: true,
    issuer,
    discoveryUrl,
    resourceUrl,
    metadata,
    readScope: process.env.CONDUIT_READ_SCOPE?.trim() || "mcp:conduit.read",
    writeScope: process.env.CONDUIT_WRITE_SCOPE?.trim() || "mcp:conduit.write",
  };
}

const scopesFromPayload = (payload: JWTPayload): string[] => {
  if (typeof payload.scope !== "string") return [];
  return payload.scope.split(/\s+/).filter(Boolean);
};

export function createTokenVerifier(config: ConduitAuthConfig): OAuthTokenVerifier {
  const jwks = createRemoteJWKSet(new URL(config.metadata.jwks_uri));

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: config.issuer,
          audience: config.resourceUrl,
          algorithms: ["RS256"],
        });

        if (!payload.sub || typeof payload.sub !== "string") throw new Error("missing sub claim");
        if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) throw new Error("expired token");

        return {
          token,
          clientId: typeof payload.azp === "string" ? payload.azp : typeof payload.client_id === "string" ? payload.client_id : "unknown",
          scopes: scopesFromPayload(payload),
          expiresAt: payload.exp,
          extra: {
            sub: payload.sub,
            email: typeof payload.email === "string" ? payload.email : undefined,
            name: typeof payload.name === "string" ? payload.name : undefined,
          },
        };
      } catch (error) {
        if (error instanceof OAuthError) throw error;
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token");
      }
    },
  };
}

export function requireScope(authInfo: AuthInfo | undefined, scope: string): void {
  if (!authInfo?.scopes.includes(scope)) {
    throw new OAuthError(OAuthErrorCode.InsufficientScope, `Required scope: ${scope}`);
  }
}

export function buildProtectedResourceMetadata(config: ConduitAuthConfig) {
  return {
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    resource: config.resourceUrl,
    scopes_supported: [config.readScope, config.writeScope],
  };
}
