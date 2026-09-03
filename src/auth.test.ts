import test from 'node:test';
import assert from 'node:assert/strict';
import { OAuthError } from '@modelcontextprotocol/server';
import { buildProtectedResourceMetadata, requireScope } from './auth.js';

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
