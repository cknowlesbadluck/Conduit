import test from 'node:test';
import assert from 'node:assert/strict';
import { OAuthError } from '@modelcontextprotocol/server';
import { requireScope } from './auth.js';

test('scope policy accepts granted scope', () => {
  assert.doesNotThrow(() => requireScope({ token: 'x', clientId: 'c', scopes: ['mcp:conduit.read'], expiresAt: Math.floor(Date.now() / 1000) + 60 }, 'mcp:conduit.read'));
});

test('scope policy rejects missing scope', () => {
  assert.throws(
    () => requireScope({ token: 'x', clientId: 'c', scopes: ['mcp:conduit.read'], expiresAt: Math.floor(Date.now() / 1000) + 60 }, 'mcp:conduit.write'),
    (error) => error instanceof OAuthError && error.code === 'insufficient_scope',
  );
});
