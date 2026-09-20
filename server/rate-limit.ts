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
const SWEEP_INTERVAL_MS = 1_000;

interface Bucket {
  failures: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();
let lastSweepAt = 0;

function isExpired(bucket: Bucket, now: number): boolean {
  return now - bucket.windowStart >= WINDOW_MS;
}

/** True when the key has used up its attempt budget for the current window. */
export function isRateLimited(key: string, now: number = Date.now()): boolean {
  const bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size < MAX_TRACKED_KEYS) return false;
    // Expired buckets should be reclaimed before we refuse new keys.
    sweepIfDue(now);
    // The map is full of still-active buckets: back off new keys instead of
    // evicting them, which would reset somebody's failure budget.
    return buckets.size >= MAX_TRACKED_KEYS;
  }
  if (isExpired(bucket, now)) {
    buckets.delete(key);
    return false;
  }
  return bucket.failures >= maxFailuresFor(key);
}

export function recordFailure(key: string, now: number = Date.now()): void {
  const bucket = buckets.get(key);
  if (bucket && !isExpired(bucket, now)) {
    bucket.failures += 1;
    return;
  }
  if (buckets.size >= MAX_TRACKED_KEYS) {
    sweepIfDue(now);
    // Still full of active buckets: skip tracking rather than evicting, and
    // let isRateLimited() keep back-pressuring this new key.
    if (buckets.size >= MAX_TRACKED_KEYS && !buckets.has(key)) return;
  }
  buckets.set(key, { failures: 1, windowStart: now });
}

export function clearFailures(key: string): void {
  buckets.delete(key);
}

export function resetRateLimits(): void {
  buckets.clear();
  lastSweepAt = 0;
}

function maxFailuresFor(key: string): number {
  return key.startsWith("activity:") ? MAX_FAILURES_PER_ACTIVITY : MAX_FAILURES_PER_IP;
}

function sweepIfDue(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  sweep(now);
}

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (isExpired(bucket, now)) buckets.delete(key);
  }
}
