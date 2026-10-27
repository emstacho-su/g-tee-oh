import { describe, expect, it } from "vitest";

import { LoginThrottle } from "../src/auth/login-throttle.js";

const WINDOW_MS = 15 * 60 * 1000;

function throttleAt(clock: { now: number }, max = 3, maxKeys = 100): LoginThrottle {
  return new LoginThrottle({ max, windowMs: WINDOW_MS, maxKeys, now: () => clock.now });
}

function failTimes(throttle: LoginThrottle, key: string, times: number): void {
  for (let attempt = 0; attempt < times; attempt += 1) {
    throttle.recordFailure(key);
  }
}

describe("R3.1 login throttle keyed on the email, failures only (O-236)", () => {
  it("R3.1 refuses an email after max failures in a window, with the seconds left", () => {
    const clock = { now: 0 };
    const throttle = throttleAt(clock);

    failTimes(throttle, "a", 2);
    expect(throttle.check("a").allowed).toBe(true);
    throttle.recordFailure("a");
    clock.now = 60_000;
    expect(throttle.check("a")).toEqual({ allowed: false, retryAfterSeconds: (WINDOW_MS - 60_000) / 1000 });
  });

  it("R3.1 checking never counts, so correct logins never consume the budget", () => {
    const clock = { now: 0 };
    const throttle = throttleAt(clock, 1);

    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(throttle.check("owner").allowed).toBe(true);
    }
    expect(throttle.trackedKeys).toBe(0);
  });

  it("R3.1 a successful login resets the email's failures", () => {
    const clock = { now: 0 };
    const throttle = throttleAt(clock);

    failTimes(throttle, "owner", 2);
    throttle.reset("owner");
    failTimes(throttle, "owner", 2);
    expect(throttle.check("owner").allowed).toBe(true);
  });

  it("R3.1 an email over the limit is allowed again once its window ends", () => {
    const clock = { now: 0 };
    const throttle = throttleAt(clock);

    failTimes(throttle, "owner", 3);
    expect(throttle.check("owner").allowed).toBe(false);
    clock.now = WINDOW_MS;
    expect(throttle.check("owner").allowed).toBe(true);
  });

  it("R3.1 counts each email on its own", () => {
    const clock = { now: 0 };
    const throttle = throttleAt(clock, 1);

    throttle.recordFailure("a");
    expect(throttle.check("a").allowed).toBe(false);
    expect(throttle.check("b").allowed).toBe(true);
  });

  it("R3.1 when full, the least recently failed under-limit email is evicted, never an over-limit one", () => {
    const clock = { now: 0 };
    const throttle = throttleAt(clock, 2, 2);

    failTimes(throttle, "owner", 2);
    throttle.recordFailure("b");
    throttle.recordFailure("c");

    expect(throttle.trackedKeys).toBe(2);
    expect(throttle.check("owner").allowed).toBe(false);
    expect(throttle.check("c").allowed).toBe(true);
  });

  it("R3.1 a repeat failure makes an email the most recent, so the eviction order is real", () => {
    const clock = { now: 0 };
    const throttle = throttleAt(clock, 3, 2);

    throttle.recordFailure("a");
    throttle.recordFailure("b");
    throttle.recordFailure("a");
    throttle.recordFailure("c");
    throttle.recordFailure("a");

    expect(throttle.check("a").allowed).toBe(false);
  });

  it("R3.1 when every tracked email is over the limit, a new email is treated as limited", () => {
    const clock = { now: 0 };
    const throttle = throttleAt(clock, 1, 2);

    throttle.recordFailure("a");
    throttle.recordFailure("b");
    throttle.recordFailure("c");

    expect(throttle.trackedKeys).toBe(2);
    expect(throttle.check("c").allowed).toBe(false);
    expect(throttle.check("a").allowed).toBe(false);
    clock.now = WINDOW_MS;
    expect(throttle.check("c").allowed).toBe(true);
  });
});
