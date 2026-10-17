/**
 * Cold-start tolerant fetch for live checks against free-tier hosts (Render spins
 * idle services down; the first request can take 20-60 s and may see 502/503/504
 * from the edge while the instance boots).
 *
 * Retries only on network errors/timeouts and on 502/503/504. Any other status
 * (including 401/404/500) is returned to the caller unchanged, so a real failure
 * is never masked as "still waking up".
 */

export const RETRYABLE_STATUSES = new Set([502, 503, 504]);

export function readPositiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export async function fetchWithRetry(url, init = {}, opts = {}) {
  const {
    attempts = 4,
    timeoutMs = 30000,
    backoffMs = 5000,
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onRetry = () => {},
  } = opts;
  const total = Math.max(1, Math.floor(attempts));
  let lastError;
  for (let attempt = 1; attempt <= total; attempt += 1) {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!RETRYABLE_STATUSES.has(res.status) || attempt === total) return res;
      lastError = new Error(`status ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === total) break;
    }
    onRetry({ attempt, reason: lastError instanceof Error ? lastError.message : String(lastError) });
    await sleep(backoffMs * attempt);
  }
  throw new Error(`${url} unreachable after ${total} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
