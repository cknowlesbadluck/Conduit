import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevelopmentAuthInfo, DEVELOPMENT_ANONYMOUS_SUBJECT, DEVELOPMENT_TOKEN_SUBJECT, getAuthenticatedClientId, getAuthenticatedSubject } from './auth.js';

test('client-credentials style payloads can authenticate without a sub claim', () => {
  const payload = { client_id: 'agent-client-123' };
  assert.equal(getAuthenticatedClientId(payload), 'agent-client-123');
  assert.equal(getAuthenticatedSubject(payload), 'agent-client-123');
});

test('user-backed payloads prefer sub as the actor identity', () => {
  const payload = { sub: 'user-123', client_id: 'agent-client-123' };
  assert.equal(getAuthenticatedClientId(payload), 'agent-client-123');
  assert.equal(getAuthenticatedSubject(payload), 'user-123');
});

test('azp is accepted as the client identifier when client_id is absent', () => {
  const payload = { azp: 'authorized-party-123' };
  assert.equal(getAuthenticatedClientId(payload), 'authorized-party-123');
  assert.equal(getAuthenticatedSubject(payload), 'authorized-party-123');
});

test('development auth subjects are stable and distinct', () => {
  assert.notEqual(DEVELOPMENT_TOKEN_SUBJECT, DEVELOPMENT_ANONYMOUS_SUBJECT);
  const tokenAuth = createDevelopmentAuthInfo(DEVELOPMENT_TOKEN_SUBJECT, 'token');
  const anonAuth = createDevelopmentAuthInfo(DEVELOPMENT_ANONYMOUS_SUBJECT, 'anonymous');
  assert.equal(tokenAuth.extra?.sub, DEVELOPMENT_TOKEN_SUBJECT);
  assert.equal(anonAuth.extra?.sub, DEVELOPMENT_ANONYMOUS_SUBJECT);
});
