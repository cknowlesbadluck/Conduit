/**
 * Server-Sent Events delivery for GET /events, hardened against the three ways the
 * previous inline handler in index.ts could hurt the process:
 *
 * 1. Polling: every subscriber ran `setInterval(replay, 2000)` forever. An async callback
 *    under setInterval overlaps itself when Postgres is slow, so N idle subscribers meant
 *    N/2 queries per second with unbounded pile-up. Polls are now single-flight
 *    (setTimeout chain; the next poll is scheduled only after the previous one settles)
 *    and back off exponentially while idle, snapping back to the minimum when new events
 *    arrive. Same-instance events still arrive immediately via the in-process
 *    subscription; the poll only exists to catch writes made by other instances.
 * 2. Backpressure: `res.write()`'s return value was ignored, so a slow or stalled client
 *    grew the socket buffer without bound. Writes now pause while the socket is not
 *    draining (undelivered events stay unmarked and are re-sent by the next replay), and
 *    a client whose buffered bytes exceed `maxBufferedBytes` is disconnected.
 * 3. Admission: hitting the subscriber cap threw *after* headers were flushed, which
 *    turned into a broken 200 stream. The cap is now checked before any bytes are
 *    written and answered with 503 + Retry-After.
 */

/** Matches store.ActivityEvent (Record<string, string>); `id` and `type` are always present. */
export type SseEvent = Record<string, string>;

export type SseResponse = {
  status(code: number): unknown;
  set(headers: Record<string, string>): unknown;
  json(body: unknown): unknown;
  flushHeaders?(): void;
  write(chunk: string): boolean;
  end(): unknown;
  readonly writableLength: number;
  readonly writableEnded?: boolean;
  on(event: "drain" | "close" | "error", listener: () => void): unknown;
};

export type SseRequest = {
  query: Record<string, unknown>;
  on(event: "close", listener: () => void): unknown;
};

export type SseOptions = {
  replay(projectId?: string): Promise<SseEvent[]>;
  subscribe(filter: { projectId?: string }, listener: (event: SseEvent) => void): () => void;
  pollMinMs?: number;
  pollMaxMs?: number;
  heartbeatMs?: number;
  maxBufferedBytes?: number;
  seenLimit?: number;
  retryAfterSeconds?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  now?: () => number;
};

export type SseStats = {
  active: number;
  admitted: number;
  rejectedAtCapacity: number;
  slowConsumerDisconnects: number;
  pausedWrites: number;
  pollErrors: number;
};

const stats: SseStats = { active: 0, admitted: 0, rejectedAtCapacity: 0, slowConsumerDisconnects: 0, pausedWrites: 0, pollErrors: 0 };

/** Process-wide SSE counters (snapshot). Counts only; safe for authenticated diagnostics. */
export function getSseStats(): SseStats { return { ...stats }; }
export function resetSseStatsForTests() { for (const key of Object.keys(stats) as (keyof SseStats)[]) stats[key] = 0; }

/** Next poll delay: reset to min on progress, otherwise double up to max. */
export function nextPollDelay(current: number, delivered: number, minMs: number, maxMs: number) {
  if (delivered > 0) return minMs;
  return Math.min(maxMs, Math.max(minMs, current * 2));
}

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function createEventStreamHandler(options: SseOptions) {
  const pollMinMs = options.pollMinMs ?? envNumber("CONDUIT_SSE_POLL_MIN_MS", 2_000);
  const pollMaxMs = Math.max(pollMinMs, options.pollMaxMs ?? envNumber("CONDUIT_SSE_POLL_MAX_MS", 30_000));
  const heartbeatMs = options.heartbeatMs ?? envNumber("CONDUIT_SSE_HEARTBEAT_MS", 15_000);
  const maxBufferedBytes = options.maxBufferedBytes ?? envNumber("CONDUIT_SSE_MAX_BUFFERED_BYTES", 1_048_576);
  const seenLimit = options.seenLimit ?? 200;
  const retryAfterSeconds = options.retryAfterSeconds ?? 5;
  const schedule = options.schedule ?? ((fn: () => void, ms: number) => { const timer = setTimeout(fn, ms); timer.unref?.(); return timer; });
  const cancel = options.cancel ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const now = options.now ?? Date.now;

  return async (req: SseRequest, res: SseResponse) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    let started = false;
    let closed = false;
    let paused = false;
    const pending: SseEvent[] = [];
    const seen = new Set<string>();
    let pollTimer: unknown;
    let heartbeatTimer: unknown;
    let pollDelay = pollMinMs;
    let unsubscribe: () => void = () => {};

    function cleanup(endResponse = false) {
      if (closed) return;
      closed = true;
      stats.active--;
      if (pollTimer !== undefined) cancel(pollTimer);
      if (heartbeatTimer !== undefined) cancel(heartbeatTimer);
      pollTimer = undefined;
      heartbeatTimer = undefined;
      unsubscribe();
      if (endResponse && !res.writableEnded) { try { res.end(); } catch { /* socket already gone */ } }
    }

    const overBudget = () => {
      if (res.writableLength <= maxBufferedBytes) return false;
      stats.slowConsumerDisconnects++;
      cleanup(true);
      return true;
    };

    const deliver = (event: SseEvent): boolean => {
      if (closed || seen.has(event.id)) return false;
      if (paused) { stats.pausedWrites++; return false; } // left unseen: the next replay re-sends it
      if (overBudget()) return false;
      seen.add(event.id);
      if (seen.size > seenLimit) seen.delete(seen.values().next().value as string);
      if (!res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)) paused = true;
      return true;
    };

    try {
      unsubscribe = options.subscribe({ projectId }, (event) => { if (!started) pending.push(event); else deliver(event); });
    } catch (error) {
      if (error instanceof Error && error.message === "event_subscriber_limit_reached") {
        stats.rejectedAtCapacity++;
        res.status(503);
        res.set({ "Retry-After": String(retryAfterSeconds) });
        res.json({ error: "event_subscriber_limit_reached" });
        return;
      }
      throw error;
    }
    stats.admitted++;
    stats.active++;

    req.on("close", () => cleanup());
    res.on("close", () => cleanup());
    res.on("error", () => cleanup());
    res.on("drain", () => { paused = false; });

    res.status(200);
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders?.();

    const replayOnce = async () => {
      let delivered = 0;
      for (const event of await options.replay(projectId)) if (deliver(event)) delivered++;
      return delivered;
    };

    const poll = async () => {
      pollTimer = undefined;
      if (closed) return;
      let delivered = 0;
      try { delivered = await replayOnce(); } catch { stats.pollErrors++; }
      if (closed) return;
      pollDelay = nextPollDelay(pollDelay, delivered, pollMinMs, pollMaxMs);
      pollTimer = schedule(() => { void poll(); }, pollDelay);
    };

    const heartbeat = () => {
      heartbeatTimer = undefined;
      if (closed) return;
      if (!paused) {
        if (overBudget()) return;
        if (!res.write(`: heartbeat ${now()}\n\n`)) paused = true;
      }
      heartbeatTimer = schedule(heartbeat, heartbeatMs);
    };

    try { await replayOnce(); } catch { stats.pollErrors++; }
    started = true;
    for (const event of pending.splice(0)) deliver(event);
    if (closed) return;
    pollTimer = schedule(() => { void poll(); }, pollDelay);
    heartbeatTimer = schedule(heartbeat, heartbeatMs);
  };
}
