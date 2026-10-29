/**
 * The spot driver (S25, R3.13): each entered state runs its one request, and an answer that
 * arrives after the state moved on is dropped instead of being read as a later request's answer.
 */
import { describe, expect, it, vi } from "vitest";

import { ApiProblem } from "../../src/api/index.js";
import { fixtureFeedback } from "../../src/fixtures/index.js";
import { fixturePlainPrompt, fixturePracticeSession, fixtureRecap } from "../../src/fixtures/trainer.js";
import { createSpotDriver, type SpotIo } from "../../src/trainer/spot-driver.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeIo(overrides: Partial<SpotIo> = {}): SpotIo {
  return {
    createSession: () => Promise.resolve(fixturePracticeSession),
    loadPrompt: () => Promise.resolve(fixturePlainPrompt),
    prefetchPrompt: vi.fn(),
    submitDecision: () => Promise.resolve(fixtureFeedback),
    endSession: () => Promise.resolve(fixtureRecap),
    onPrompt: vi.fn(),
    onProblem: vi.fn(),
    now: () => 0,
    newKey: () => "driver-key",
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await new Promise((done) => setTimeout(done, 0));
}

describe("R3.13 spot driver", () => {
  it("R3.13 a prompt read that fails after the session was ended is dropped", async () => {
    const read = deferred<typeof fixturePlainPrompt>();
    const io = fakeIo({ loadPrompt: () => read.promise });
    const changes = vi.fn();
    const driver = createSpotDriver(() => io, changes);
    driver.send({ type: "start", key: "k", rng: false });
    await flush();
    expect(driver.getState().kind).toBe("loading_prompt");
    driver.send({ type: "end", key: "end" });
    await flush();
    expect(driver.getState().kind).toBe("ended");
    read.reject(new TypeError("Failed to fetch"));
    await flush();
    expect(driver.getState().kind).toBe("ended");
    expect(io.onProblem).not.toHaveBeenCalled();
  });

  it("R3.13 a prompt that arrives after the session was ended is dropped too", async () => {
    const read = deferred<typeof fixturePlainPrompt>();
    const io = fakeIo({ loadPrompt: () => read.promise });
    const driver = createSpotDriver(() => io, vi.fn());
    driver.send({ type: "start", key: "k", rng: false });
    await flush();
    driver.send({ type: "end", key: "end" });
    read.resolve(fixturePlainPrompt);
    await flush();
    expect(driver.getState().kind).toBe("ended");
    expect(io.onPrompt).not.toHaveBeenCalled();
  });

  it("R3.13 after dispose (the screen unmounted) a late answer writes nothing and events are ignored", async () => {
    const read = deferred<typeof fixturePlainPrompt>();
    const io = fakeIo({ loadPrompt: () => read.promise });
    const changes = vi.fn();
    const driver = createSpotDriver(() => io, changes);
    driver.send({ type: "start", key: "k", rng: false });
    await flush();
    const calls = changes.mock.calls.length;
    driver.dispose();
    read.resolve(fixturePlainPrompt);
    await flush();
    driver.send({ type: "end", key: "end" });
    expect(changes).toHaveBeenCalledTimes(calls);
    expect(io.onPrompt).not.toHaveBeenCalled();
    expect(driver.getState().kind).toBe("loading_prompt");
  });

  it("R3.13 activate after dispose (React's development double mount) lets events through again", async () => {
    const changes = vi.fn();
    const driver = createSpotDriver(() => fakeIo(), changes);
    driver.dispose();
    driver.activate();
    driver.send({ type: "start", key: "k", rng: false });
    await flush();
    expect(driver.getState().kind).toBe("await_action");
  });

  it("R3.13 a 409 session-ended fetches the recap through POST end with a new key", async () => {
    const endSession = vi.fn(() => Promise.resolve(fixtureRecap));
    const io = fakeIo({
      loadPrompt: () => Promise.reject(new ApiProblem({ status: 409, slug: "session-ended", title: "t" })),
      endSession,
    });
    const driver = createSpotDriver(() => io, vi.fn());
    driver.send({ type: "start", key: "k", rng: false });
    await flush();
    await flush();
    expect(endSession).toHaveBeenCalledWith(fixturePracticeSession.session_id, "driver-key");
    expect(driver.getState()).toEqual({ kind: "ended", recap: fixtureRecap });
  });

  it("R3.13 an ignored event changes nothing and reports nothing", () => {
    const changes = vi.fn();
    const driver = createSpotDriver(() => fakeIo(), changes);
    driver.send({ type: "next" });
    expect(changes).not.toHaveBeenCalled();
    expect(driver.getState()).toEqual({ kind: "idle" });
  });

  it("R3.13 a failure reaches onProblem and becomes a retryable error",async () => {
    const io = fakeIo({ createSession: () => Promise.reject(new TypeError("Failed to fetch")) });
    const driver = createSpotDriver(() => io, vi.fn());
    driver.send({ type: "start", key: "k", rng: true });
    await flush();
    expect(io.onProblem).toHaveBeenCalledWith({ kind: "network", status: null });
    expect(driver.getState()).toMatchObject({ kind: "error", retry: "start" });
  });
});

describe("R3.31 PR #45 review round 2, finding 4: an unplayed over-limit prompt never reaches the screen", () => {
  it("R3.31 at the limit the next hand's prompt is not shown: onPrompt sees only the played hands", async () => {
    const STREET = { stop_rule: "end_of_street", pause: "every_action", speed: "normal", quick_result: false } as const;
    const hands = Array.from({ length: 11 }, (_, hand) => ({ ...fixturePlainPrompt, hand_no: hand, state_version: 3 + 2 * hand }));
    const queue = [...hands];
    let version = 3;
    const io = fakeIo({
      loadPrompt: () => Promise.resolve(queue.shift() ?? hands[10]!),
      submitDecision: () => {
        version += 1;
        return Promise.resolve({ ...fixtureFeedback, state_version: version });
      },
    });
    const driver = createSpotDriver(() => io, vi.fn());
    driver.send({ type: "start", key: "k", rng: false, trainer: STREET, length: 10 });
    await flush();
    for (let hand = 0; hand < 10; hand += 1) {
      const shown = driver.getState();
      if (shown.kind !== "await_action") throw new Error(`hand ${hand + 1}: expected a prompt, got ${shown.kind}`);
      driver.send({ type: "choose_action", actionIndex: shown.prompt.buttons[0]?.index ?? 0, at: 1, key: `d${hand}` });
      await flush();
      driver.send({ type: "next", endKey: `e${hand}` });
      await flush();
    }
    expect(["ending", "ended"]).toContain(driver.getState().kind);
    expect(io.onPrompt).toHaveBeenCalledTimes(10);
    expect(io.onPrompt).not.toHaveBeenCalledWith(hands[10]);
  });
});
