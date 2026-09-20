/**
 * In-memory attempt limiter for admin password checks.
 *
 * Besides stopping password guessing this also bounds scrypt work, since each
 * failed attempt costs CPU. State lives in this process only: it resets on
 * restart and is not shared between replicas, which is fine for the
 * single-container deployment this app ships with.
 */

const WINDOW_MS = 10 * 60_000;
const MAX_FAILURES_PER_IP = 10;
const MAX_FAILURES_PER_ACTIVITY = 30;
const MAX_TRACKED_KEYS = 5_000;

interface Bucket {
  failures: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

function isExpired(bucket: Bucket, now: number): boolean {
  return now - bucket.windowStart >= WINDOW_MS;
}

/** True when the key has used up its attempt budget for the current window. */
export function isRateLimited(key: string, now: number = Date.now()): boolean {
  const bucket = buckets.get(key);
  if (!bucket) return false;
  if (isExpired(bucket, now)) {
    buckets.delete(key);
    return false;
  }
  return bucket.failures >= maxFailuresFor(key);
}

export function recordFailure(key: string, now: number = Date.now()): void {
  const bucket = buckets.get(key);
  if (!bucket || isExpired(bucket, now)) {
    buckets.set(key, { failures: 1, windowStart: now });
  } else {
    bucket.failures += 1;
  }
  if (buckets.size > MAX_TRACKED_KEYS) sweep(now);
}

export function clearFailures(key: string): void {
  buckets.delete(key);
}

export function resetRateLimits(): void {
  buckets.clear();
}

function maxFailuresFor(key: string): number {
  return key.startsWith("activity:") ? MAX_FAILURES_PER_ACTIVITY : MAX_FAILURES_PER_IP;
}

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (isExpired(bucket, now)) buckets.delete(key);
  }
}
