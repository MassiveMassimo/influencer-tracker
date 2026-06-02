const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RetryOpts {
  retries?: number;
  isRetryable?: (e: unknown) => boolean;
  delayMs?: (attempt: number) => number; // attempt is 0-based
  label?: string;
}

// Retry an async fn with backoff. Default backoff is exponential capped at 30s.
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const {
    retries = 5,
    isRetryable = () => true,
    delayMs = (a) => Math.min(2 ** a, 30) * 1000,
    label = "",
  } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries || !isRetryable(e)) throw e;
      const wait = delayMs(attempt);
      console.warn(`retry ${attempt + 1}/${retries}${label ? ` ${label}` : ""} in ${(wait / 1000).toFixed(1)}s`);
      await sleep(wait);
    }
  }
}
