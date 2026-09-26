export const EVENT_STREAM_CAPACITY_ERROR = Object.freeze({ error: "event_stream_capacity_exhausted" });

type EventSource = {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
};
type StreamResponse = EventSource & {
  write(chunk: string): unknown;
  end(): unknown;
  writableEnded?: boolean;
};
type StreamRequest = EventSource;

export interface EventStreamAdmission {
  readonly cleanup: () => void;
  addCleanup(cleanup: () => void): void;
  addTimer(timer: NodeJS.Timeout): void;
}

type ActiveStream = {
  response: StreamResponse;
  cleanup: () => void;
};

/** Owns SSE capacity and all resources associated with every admitted response. */
export class EventStreamManager {
  private accepting = true;
  private readonly active = new Map<StreamResponse, ActiveStream>();

  constructor(readonly capacity = 100) {
    if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError("event stream capacity must be a non-negative integer");
  }

  get activeCount() { return this.active.size; }
  get isAccepting() { return this.accepting; }

  /** Must be called before committing response headers. A successful call reserves a slot immediately. */
  admit(request: StreamRequest, response: StreamResponse): EventStreamAdmission | null {
    if (!this.accepting || this.active.size >= this.capacity) return null;

    const cleanups = new Set<() => void>();
    const timers = new Set<NodeJS.Timeout>();
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      request.off("close", cleanup);
      request.off("error", cleanup);
      response.off("close", cleanup);
      response.off("error", cleanup);
      for (const timer of timers) clearInterval(timer);
      timers.clear();
      for (const release of cleanups) {
        try { release(); } catch { /* cleanup of one resource must not prevent the rest */ }
      }
      cleanups.clear();
      this.active.delete(response);
    };

    // Register before returning so concurrent handlers cannot over-admit.
    this.active.set(response, { response, cleanup });
    request.on("close", cleanup);
    request.on("error", cleanup);
    response.on("close", cleanup);
    response.on("error", cleanup);

    return {
      cleanup,
      addCleanup: (release) => { if (cleaned) release(); else cleanups.add(release); },
      addTimer: (timer) => { if (cleaned) clearInterval(timer); else timers.add(timer); },
    };
  }

  /** Reject future admissions, notify current clients, and synchronously release their resources. */
  shutdown(retryMilliseconds = 10_000) {
    this.accepting = false;
    for (const { response, cleanup } of [...this.active.values()]) {
      try {
        if (!response.writableEnded) {
          response.write(`retry: ${retryMilliseconds}\nevent: shutdown\ndata: {"reason":"server_shutdown"}\n\n`);
          response.end();
        }
      } catch { /* a broken socket is still cleaned below */ }
      cleanup();
    }
  }
}
