import { describe, expect, it } from "vitest";

import { LoginThrottle } from "../src/auth/login-throttle.js";

const WINDOW_MS = 15 * 60 * 1000;

function throttleAt(clock: { now: number }, max = 3, maxKeys = 100): LoginThrottle {
  return new LoginThrottle({ max, windowMs: WINDOW_MS, maxKeys, now: () => clock.now });
}

describe("R3.1 login throttle keyed on the email (O-236)", () => {
  it("R3.1 allows max attempts per window and refuses the next with the seconds left", () => {
    const clock = { now: 0 };
    const throttle = throttleAt(clock);

    expect([throttle.hit("a"), throttle.hit("a"), throttle.hit("a")].every((verdict) => verdict.allowed)).toBe(true);
    clock.now = 60_000;
    expect(throttle.hit("a")).toEqual({ allowed: false, retryAfterSeconds: (WINDOW_MS - 60_000) / 1000 });
  });

  it("R3.1 counts each key on its own and opens a new window once the old one ends", () => {
    const clock = { now: 0 };
    const throttle = throttleAt(clock, 1);

    expect(throttle.hit("a").allowed).toBe(true);
    expect(throttle.hit("b").allowed).toBe(true);
    expect(throttle.hit("a").allowed).toBe(false);
    clock.now = WINDOW_MS;
    expect(throttle.hit("a").allowed).toBe(true);
  });

  it("R3.1 stays bounded: expired windows go first, then the oldest live one", () => {
    const clock = { now: 0 };
    const throttle = throttleAt(clock, 1, 2);

    throttle.hit("a");
    throttle.hit("b");
    throttle.hit("c");
    expect(throttle.trackedKeys).toBe(2);
    clock.now = WINDOW_MS;
    throttle.hit("d");
    expect(throttle.trackedKeys).toBe(1);
  });
});
