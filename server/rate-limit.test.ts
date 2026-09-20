import { beforeEach, describe, expect, it } from "vitest";
import { isRateLimited, recordFailure, resetRateLimits } from "./rate-limit";

const WINDOW_MS = 10 * 60_000;

beforeEach(() => {
  resetRateLimits();
});

describe("rate limiter", () => {
  it("blocks a key after its failure budget is used up", () => {
    const t0 = 1_000_000;
    for (let attempt = 0; attempt < 10; attempt++) {
      recordFailure("ip:203.0.113.7", t0);
    }
    expect(isRateLimited("ip:203.0.113.7", t0)).toBe(true);
    // Other keys are unaffected.
    expect(isRateLimited("ip:203.0.113.8", t0)).toBe(false);
  });

  it("forgets failures once the window passes", () => {
    const t0 = 1_000_000;
    for (let attempt = 0; attempt < 30; attempt++) {
      recordFailure("activity:abc", t0);
    }
    expect(isRateLimited("activity:abc", t0)).toBe(true);
    expect(isRateLimited("activity:abc", t0 + WINDOW_MS)).toBe(false);
  });

  it("backs off new keys instead of evicting active buckets at capacity", () => {
    for (let index = 0; index < 5_000; index++) {
      recordFailure(`ip:198.51.100.${index}`);
    }
    // A brand new key is rejected while the map is full of active buckets...
    expect(isRateLimited("ip:203.0.113.99")).toBe(true);
    // ...but tracked buckets keep their own budgets.
    expect(isRateLimited("ip:198.51.100.0")).toBe(false);
  });

  it("reclaims capacity after active buckets expire", () => {
    const t0 = 1_000_000;
    for (let index = 0; index < 5_000; index++) {
      recordFailure(`ip:198.51.100.${index}`, t0);
    }
    const later = t0 + WINDOW_MS + 1;
    expect(isRateLimited("ip:203.0.113.99", later)).toBe(false);
    recordFailure("ip:203.0.113.99", later);
    expect(isRateLimited("ip:203.0.113.99", later)).toBe(false);
  });
});
