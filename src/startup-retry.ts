export interface StartupRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onRetry?: (label: string, failedAttempt: number, delayMs: number) => void;
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Bounded exponential retry for transient startup dependencies.
 * Does not log connection strings, error messages, or other provider details.
 */
export async function retryStartup<T>(
  label: string,
  operation: () => Promise<T>,
  options: StartupRetryOptions = {},
): Promise<T> {
  const attempts = Number.isFinite(options.attempts) && (options.attempts ?? 0) >= 1
    ? Math.floor(options.attempts!)
    : 1;
  const baseDelayMs = Number.isFinite(options.baseDelayMs) && (options.baseDelayMs ?? 0) > 0
    ? Math.floor(options.baseDelayMs!)
    : 1_000;
  const requestedMax = options.maxDelayMs;
  const maxDelayMs = Number.isFinite(requestedMax) && (requestedMax ?? 0) > 0
    ? Math.max(baseDelayMs, Math.floor(requestedMax!))
    : baseDelayMs;
  const sleep = options.sleep ?? defaultSleep;
  const onRetry = options.onRetry ?? ((name, failedAttempt, delay) => {
    console.warn(`Startup dependency ${name} unavailable (attempt ${failedAttempt}/${attempts}); retrying in ${delay}ms.`);
  });

  let delayMs = Math.min(baseDelayMs, maxDelayMs);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts) throw error;
      onRetry(label, attempt, delayMs);
      await sleep(delayMs);
      delayMs = Math.min(maxDelayMs, delayMs * 2);
    }
  }
  throw new Error(`Startup dependency ${label} exhausted retries.`);
}
