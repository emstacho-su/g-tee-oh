/**
 * Single flight for identical Ask cache misses (R3.20, PR #29 review L10): one generation per key
 * is visible to later requests, and an older generation that settles never removes a newer one.
 */
import { describe, expect, it } from "vitest";

import { runAlone, runningFor } from "../src/explain/single-flight.js";

function deferred(): { promise: Promise<string>; resolve: (value: string) => void } {
  let resolve: (value: string) => void = () => undefined;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("R3.20 single flight (PR #29 review L10)", () => {
  it("R3.20 a running generation is visible under its key and removed when it settles, success or failure", async () => {
    const work = deferred();
    const running = runAlone("key-a", () => work.promise);
    expect(runningFor("key-a")).toBeDefined();
    expect(runningFor("key-b")).toBeUndefined();
    work.resolve("answer");
    await expect(running).resolves.toBe("answer");
    expect(runningFor("key-a")).toBeUndefined();
    await expect(runAlone("key-a", () => Promise.reject(new Error("model failed")))).rejects.toThrow("model failed");
    expect(runningFor("key-a")).toBeUndefined();
  });

  it("R3.20 an older generation that settles after a newer one started leaves the newer entry in place", async () => {
    const older = deferred();
    const newer = deferred();
    const first = runAlone("key-c", () => older.promise);
    const second = runAlone("key-c", () => newer.promise);
    older.resolve("old");
    await first;
    expect(runningFor("key-c")).toBeDefined();
    newer.resolve("new");
    await second;
    expect(runningFor("key-c")).toBeUndefined();
  });
});
