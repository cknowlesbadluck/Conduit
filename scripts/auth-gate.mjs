/**
 * Read-only fail-closed auth-gate check (--auth-gate). Sends one unauthenticated request per
 * gated surface and expects 401/403. Anything else (2xx, 3xx, 404, 5xx, network error) is
 * reported as not gated. No credentials are sent or read; requests are non-mutating
 * (GET list, or MCP tools/list with no token).
 */
export const AUTH_GATE_TARGETS = Object.freeze([
  { name: "resonance-executions", method: "GET", url: "https://resonancenexus.netlify.app/api/nexus/executions" },
  { name: "conduit-mcp", method: "POST", url: "https://conduit-feco.onrender.com/mcp",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    // MCP authorization spec / RFC 9728: a 401 must carry a Bearer challenge that
    // points clients at protected-resource metadata. A bare 401 (e.g. from a proxy)
    // is not proof that Conduit's own auth layer answered.
    requireBearerChallenge: true },
]);

/** Pure: classify one observed status. */
export function classifyAuthGate(status) {
  if (status === 401 || status === 403) return { gated: true, reason: "rejected_unauthenticated" };
  if (typeof status !== "number") return { gated: false, reason: "unreachable" };
  if (status >= 200 && status < 300) return { gated: false, reason: "open_without_auth" };
  return { gated: false, reason: `unexpected_status_${status}` };
}

/** Pure: summarize. Fails closed: empty input is not ok. */
/**
 * Pure: when a target requires it, a rejecting status must come with
 * `WWW-Authenticate: Bearer ... resource_metadata="https://..."`. Fails closed:
 * missing/malformed header => not gated.
 */
export function checkBearerChallenge(header) {
  if (typeof header !== "string") return { ok: false, reason: "missing_bearer_challenge" };
  // Take only the Bearer challenge: from "Bearer" up to the next "<scheme> <token>=" challenge start.
  const start = /(?:^|,)\s*Bearer(?=\s|$)/i.exec(header);
  if (!start) return { ok: false, reason: "missing_bearer_challenge" };
  let rest = header.slice(start.index + start[0].length);
  const next = /,\s*[A-Za-z][\w-]*\s+[\w-]+=/.exec(rest);
  if (next) rest = rest.slice(0, next.index);
  // Exact auth-param names only (param = token "=" quoted-string), comma separated.
  const params = new Map();
  for (const m of rest.matchAll(/(?:^|,)\s*([A-Za-z][\w-]*)\s*=\s*"([^"]*)"/g)) params.set(m[1].toLowerCase(), m[2]);
  const meta = params.get("resource_metadata");
  if (meta === undefined) return { ok: false, reason: "missing_resource_metadata" };
  let url;
  try { url = new URL(meta); } catch { return { ok: false, reason: "invalid_resource_metadata" }; }
  if (url.protocol !== "https:") return { ok: false, reason: "insecure_resource_metadata" };
  return { ok: true, reason: "bearer_challenge" };
}

export function summarizeAuthGate(checks) {
  const open = checks.filter((c) => !c.gated).map((c) => c.name);
  return { ok: checks.length > 0 && open.length === 0, open, checks };
}

export async function runAuthGate(targets = AUTH_GATE_TARGETS, { fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
  const checks = await Promise.all(targets.map(async (t) => {
    let status;
    let challenge;
    try {
      const res = await fetchImpl(t.url, { method: t.method, headers: t.headers, body: t.body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      status = res.status;
      challenge = res.headers?.get?.("www-authenticate") ?? undefined;
    } catch { status = undefined; }
    const base = classifyAuthGate(status);
    if (base.gated && t.requireBearerChallenge && status === 401) {
      const c = checkBearerChallenge(challenge);
      if (!c.ok) return { name: t.name, status, gated: false, reason: c.reason };
    }
    return { name: t.name, status: status ?? null, ...base };
  }));
  return summarizeAuthGate(checks);
}
