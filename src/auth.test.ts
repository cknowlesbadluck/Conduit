import test from 'node:test';
import assert from 'node:assert/strict';
import { OAuthError } from '@modelcontextprotocol/server';
import { buildProtectedResourceMetadata, requireScope, loadAuthConfig } from './auth.js';

test('scope policy accepts granted scope', () => {
  assert.doesNotThrow(() => requireScope({ token: 'x', clientId: 'c', scopes: ['mcp:conduit.read'], expiresAt: Math.floor(Date.now() / 1000) + 60 }, 'mcp:conduit.read'));
});

test('scope policy rejects missing scope', () => {
  assert.throws(
    () => requireScope({ token: 'x', clientId: 'c', scopes: ['mcp:conduit.read'], expiresAt: Math.floor(Date.now() / 1000) + 60 }, 'mcp:conduit.write'),
    (error) => error instanceof OAuthError && error.code === 'insufficient_scope',
  );
});

test('protected resource metadata identifies the MCP resource and supported scopes', () => {
  const metadata = buildProtectedResourceMetadata({
    enabled: true,
    issuer: 'https://api.descope.com/v1/apps/agentic/example/resource',
    discoveryUrl: 'https://api.descope.com/example/.well-known/openid-configuration',
    resourceUrl: 'https://conduit-feco.onrender.com/mcp',
    metadata: {} as never,
    readScope: 'mcp:conduit.read',
    writeScope: 'mcp:conduit.write',
  });

  assert.deepEqual(metadata, {
    authorization_servers: ['https://api.descope.com/v1/apps/agentic/example/resource'],
    bearer_methods_supported: ['header'],
    resource: 'https://conduit-feco.onrender.com/mcp',
    scopes_supported: ['mcp:conduit.read', 'mcp:conduit.write'],
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('loadAuthConfig rejects HTTP discovery URL in production', async () => {
  const origEnv = process.env.NODE_ENV;
  const origDiscovery = process.env.DESCOPE_MCP_SERVER_WELL_KNOWN_URL;
  const origPublic = process.env.PUBLIC_URL;
  try {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_URL = 'https://conduit-feco.onrender.com';
    process.env.DESCOPE_MCP_SERVER_WELL_KNOWN_URL = 'http://api.descope.com/.well-known/openid-configuration';

    await assert.rejects(
      async () => loadAuthConfig(),
      (err: Error) => err.message.includes('must use HTTPS in production'),
    );
  } finally {
    restoreEnv('NODE_ENV', origEnv);
    restoreEnv('DESCOPE_MCP_SERVER_WELL_KNOWN_URL', origDiscovery);
    restoreEnv('PUBLIC_URL', origPublic);
  }
});

test('loadAuthConfig rejects insecure discovered endpoints in production', async () => {
  const origEnv = process.env.NODE_ENV;
  const origDiscovery = process.env.DESCOPE_MCP_SERVER_WELL_KNOWN_URL;
  const origPublic = process.env.PUBLIC_URL;
  const origFetch = globalThis.fetch;

  try {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_URL = 'https://conduit-feco.onrender.com';
    process.env.DESCOPE_MCP_SERVER_WELL_KNOWN_URL = 'https://api.descope.com/.well-known/openid-configuration';

    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        issuer: 'http://api.descope.com',
        jwks_uri: 'https://api.descope.com/jwks',
        authorization_endpoint: 'https://api.descope.com/auth',
        token_endpoint: 'https://api.descope.com/token',
      }),
    })) as unknown as typeof fetch;

    await assert.rejects(
      async () => loadAuthConfig(),
      (err: Error) => err.message.includes('must use HTTPS in production'),
    );

    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        issuer: 'https://api.descope.com',
        jwks_uri: 'http://api.descope.com/jwks',
        authorization_endpoint: 'https://api.descope.com/auth',
        token_endpoint: 'https://api.descope.com/token',
      }),
    })) as unknown as typeof fetch;

    await assert.rejects(
      async () => loadAuthConfig(),
      (err: Error) => err.message.includes('must use HTTPS in production'),
    );
  } finally {
    restoreEnv('NODE_ENV', origEnv);
    restoreEnv('DESCOPE_MCP_SERVER_WELL_KNOWN_URL', origDiscovery);
    restoreEnv('PUBLIC_URL', origPublic);
    globalThis.fetch = origFetch;
  }
});

test('loadAuthConfig validates DESCOPE_MCP_SERVER_ISSUER match and scheme', async () => {
  const origEnv = process.env.NODE_ENV;
  const origDiscovery = process.env.DESCOPE_MCP_SERVER_WELL_KNOWN_URL;
  const origIssuer = process.env.DESCOPE_MCP_SERVER_ISSUER;
  const origPublic = process.env.PUBLIC_URL;
  const origFetch = globalThis.fetch;

  try {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_URL = 'https://conduit-feco.onrender.com';
    process.env.DESCOPE_MCP_SERVER_WELL_KNOWN_URL = 'https://api.descope.com/.well-known/openid-configuration';
    process.env.DESCOPE_MCP_SERVER_ISSUER = 'https://other-issuer.com';

    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        issuer: 'https://api.descope.com',
        jwks_uri: 'https://api.descope.com/jwks',
        authorization_endpoint: 'https://api.descope.com/auth',
        token_endpoint: 'https://api.descope.com/token',
      }),
    })) as unknown as typeof fetch;

    await assert.rejects(
      async () => loadAuthConfig(),
      (err: Error) => err.message.includes('does not match the issuer returned by discovery'),
    );
  } finally {
    restoreEnv('NODE_ENV', origEnv);
    restoreEnv('DESCOPE_MCP_SERVER_WELL_KNOWN_URL', origDiscovery);
    restoreEnv('DESCOPE_MCP_SERVER_ISSUER', origIssuer);
    restoreEnv('PUBLIC_URL', origPublic);
    globalThis.fetch = origFetch;
  }
});
