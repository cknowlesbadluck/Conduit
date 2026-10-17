import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type JWTPayload } from 'jose';
import { OAuthError } from '@modelcontextprotocol/server';
import { createTokenVerifier, loadAuthConfig, type ConduitAuthConfig } from './auth.js';

// Local, offline JWKS + discovery server. No network, no secrets.
const RESOURCE = 'https://conduit.example.test/mcp';
let server: Server;
let base = '';
let issuer = '';
let signingKey: CryptoKey;
let otherKey: CryptoKey;
let discovery: Record<string, unknown> | null = null;
let discoveryStatus = 200;

before(async () => {
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey as CryptoKey;
  otherKey = (await generateKeyPair('RS256')).privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  server = createServer((req, res) => {
    if (req.url === '/jwks') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (req.url === '/.well-known/openid-configuration') {
      res.writeHead(discoveryStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify(discovery ?? {}));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  issuer = `${base}/issuer`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const config = (): ConduitAuthConfig => ({
  enabled: true,
  issuer,
  discoveryUrl: `${base}/.well-known/openid-configuration`,
  resourceUrl: RESOURCE,
  metadata: { issuer, jwks_uri: `${base}/jwks`, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, response_types_supported: ['code'] },
  readScope: 'mcp:conduit.read',
  writeScope: 'mcp:conduit.write',
});

async function sign(claims: JWTPayload, opts: { key?: CryptoKey; iss?: string; aud?: string; exp?: number | null; alg?: string } = {}) {
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: opts.alg ?? 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? issuer)
    .setAudience(opts.aud ?? RESOURCE)
    .setIssuedAt();
  if (opts.exp !== null) jwt = jwt.setExpirationTime(opts.exp ?? Math.floor(Date.now() / 1000) + 300);
  return jwt.sign(opts.key ?? signingKey);
}

const isInvalidToken = (error: unknown) => error instanceof OAuthError && error.code === 'invalid_token';

test('verifier accepts a valid RS256 token and maps identity, scopes and expiry', async () => {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const token = await sign({ sub: 'user-1', client_id: 'client-1', scope: 'mcp:conduit.read  mcp:conduit.write', email: 'a@example.test', name: 'A' }, { exp });
  const info = await createTokenVerifier(config()).verifyAccessToken(token);
  assert.equal(info.token, token);
  assert.equal(info.clientId, 'client-1');
  assert.deepEqual(info.scopes, ['mcp:conduit.read', 'mcp:conduit.write']);
  assert.equal(info.expiresAt, exp);
  assert.deepEqual(info.extra, { sub: 'user-1', email: 'a@example.test', name: 'A' });
});

test('verifier falls back to sub as clientId and to empty scopes when scope is not a string', async () => {
  const token = await sign({ sub: 'user-2', scope: ['mcp:conduit.write'] as unknown as string });
  const info = await createTokenVerifier(config()).verifyAccessToken(token);
  assert.equal(info.clientId, 'user-2');
  assert.deepEqual(info.scopes, []);
});

test('verifier accepts client-credentials tokens identified only by azp', async () => {
  const token = await sign({ azp: 'machine-1', scope: 'mcp:conduit.read' });
  const info = await createTokenVerifier(config()).verifyAccessToken(token);
  assert.equal(info.clientId, 'machine-1');
  assert.equal(info.extra?.sub, undefined);
});

test('verifier rejects a token with no sub, client_id or azp', async () => {
  const token = await sign({ scope: 'mcp:conduit.write' });
  await assert.rejects(createTokenVerifier(config()).verifyAccessToken(token), isInvalidToken);
});

test('verifier rejects a token with no exp claim (fail closed)', async () => {
  const token = await sign({ sub: 'user-3' }, { exp: null });
  await assert.rejects(createTokenVerifier(config()).verifyAccessToken(token), isInvalidToken);
});

test('verifier rejects an expired token', async () => {
  const token = await sign({ sub: 'user-4' }, { exp: Math.floor(Date.now() / 1000) - 10 });
  await assert.rejects(createTokenVerifier(config()).verifyAccessToken(token), isInvalidToken);
});

test('verifier rejects wrong issuer and wrong audience', async () => {
  const verifier = createTokenVerifier(config());
  await assert.rejects(verifier.verifyAccessToken(await sign({ sub: 'u' }, { iss: `${base}/evil` })), isInvalidToken);
  await assert.rejects(verifier.verifyAccessToken(await sign({ sub: 'u' }, { aud: 'https://other.example.test/mcp' })), isInvalidToken);
});

test('verifier rejects a token signed by a key that is not in the JWKS', async () => {
  const token = await sign({ sub: 'u' }, { key: otherKey });
  await assert.rejects(createTokenVerifier(config()).verifyAccessToken(token), isInvalidToken);
});

test('verifier rejects HS256 (alg confusion) and garbage tokens with a generic invalid_token error', async () => {
  const hmac = new TextEncoder().encode('not-a-real-secret-not-a-real-secret');
  const hs = await new SignJWT({ sub: 'u' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(issuer).setAudience(RESOURCE).setExpirationTime('5m').sign(hmac);
  const verifier = createTokenVerifier(config());
  await assert.rejects(verifier.verifyAccessToken(hs), isInvalidToken);
  await assert.rejects(verifier.verifyAccessToken('not.a.jwt'), (error: unknown) => isInvalidToken(error) && (error as Error).message === 'Invalid access token');
});

// ---- loadAuthConfig paths not covered by auth.test.ts ----

async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const baseEnv = () => ({
  DESCOPE_MCP_SERVER_WELL_KNOWN_URL: `${base}/.well-known/openid-configuration`,
  MCP_RESOURCE_URL: undefined,
  PUBLIC_URL: 'https://conduit.example.test/',
  DESCOPE_MCP_SERVER_ISSUER: undefined,
  CONDUIT_READ_SCOPE: undefined,
  CONDUIT_WRITE_SCOPE: undefined,
  NODE_ENV: 'test',
});

const goodDiscovery = () => ({ issuer, jwks_uri: `${base}/jwks`, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token` });

test('loadAuthConfig returns null when OAuth discovery is not configured', async () => {
  await withEnv({ DESCOPE_MCP_SERVER_WELL_KNOWN_URL: undefined }, async () => {
    assert.equal(await loadAuthConfig(), null);
  });
});

test('loadAuthConfig derives the resource URL from PUBLIC_URL, defaults scopes and response types', async () => {
  discovery = { ...goodDiscovery(), response_types_supported: [1, 2] };
  discoveryStatus = 200;
  await withEnv(baseEnv(), async () => {
    const cfg = await loadAuthConfig();
    assert.ok(cfg);
    assert.equal(cfg.resourceUrl, 'https://conduit.example.test/mcp');
    assert.equal(cfg.readScope, 'mcp:conduit.read');
    assert.equal(cfg.writeScope, 'mcp:conduit.write');
    assert.deepEqual(cfg.metadata.response_types_supported, ['code']);
  });
});

test('loadAuthConfig honours configured scopes and a matching configured issuer', async () => {
  discovery = { ...goodDiscovery(), response_types_supported: ['code', 'token'] };
  await withEnv({ ...baseEnv(), CONDUIT_READ_SCOPE: ' r ', CONDUIT_WRITE_SCOPE: 'w', DESCOPE_MCP_SERVER_ISSUER: issuer }, async () => {
    const cfg = await loadAuthConfig();
    assert.equal(cfg?.readScope, 'r');
    assert.equal(cfg?.writeScope, 'w');
    assert.deepEqual(cfg?.metadata.response_types_supported, ['code', 'token']);
  });
});

test('loadAuthConfig requires PUBLIC_URL when MCP_RESOURCE_URL is absent', async () => {
  discovery = goodDiscovery();
  await withEnv({ ...baseEnv(), PUBLIC_URL: '  ' }, async () => {
    await assert.rejects(loadAuthConfig(), /PUBLIC_URL is required/);
  });
});

test('loadAuthConfig rejects invalid resource and discovery URLs', async () => {
  await withEnv({ ...baseEnv(), MCP_RESOURCE_URL: 'not a url' }, async () => {
    await assert.rejects(loadAuthConfig(), /MCP_RESOURCE_URL must be a valid absolute URL/);
  });
  await withEnv({ ...baseEnv(), DESCOPE_MCP_SERVER_WELL_KNOWN_URL: 'nope' }, async () => {
    await assert.rejects(loadAuthConfig(), /DESCOPE_MCP_SERVER_WELL_KNOWN_URL must be a valid absolute URL/);
  });
  await withEnv({ ...baseEnv(), MCP_RESOURCE_URL: 'http://conduit.example.test/mcp', NODE_ENV: 'production' }, async () => {
    await assert.rejects(loadAuthConfig(), /MCP_RESOURCE_URL must use HTTPS in production/);
  });
});

test('loadAuthConfig fails closed on a non-2xx discovery response', async () => {
  discoveryStatus = 503;
  try {
    await withEnv(baseEnv(), async () => {
      await assert.rejects(loadAuthConfig(), /HTTP 503/);
    });
  } finally { discoveryStatus = 200; }
});

test('loadAuthConfig fails closed when discovery omits a required field', async () => {
  for (const field of ['issuer', 'jwks_uri', 'authorization_endpoint', 'token_endpoint'] as const) {
    const d: Record<string, unknown> = goodDiscovery();
    delete d[field];
    discovery = d;
    await withEnv(baseEnv(), async () => {
      await assert.rejects(loadAuthConfig(), /missing issuer, jwks_uri, authorization_endpoint, or token_endpoint/, field);
    });
  }
});

test('loadAuthConfig rejects a discovered endpoint that is not a URL', async () => {
  discovery = { ...goodDiscovery(), token_endpoint: 'not a url' };
  await withEnv(baseEnv(), async () => {
    await assert.rejects(loadAuthConfig(), /invalid URL for token_endpoint/);
  });
});

test('loadAuthConfig rejects an invalid configured issuer', async () => {
  discovery = goodDiscovery();
  await withEnv({ ...baseEnv(), DESCOPE_MCP_SERVER_ISSUER: 'not a url' }, async () => {
    await assert.rejects(loadAuthConfig(), /DESCOPE_MCP_SERVER_ISSUER must be a valid absolute URL/);
  });
});
