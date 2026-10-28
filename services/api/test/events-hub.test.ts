/**
 * The event hub at unit level (R3.4, R3.5, A4 section 4, O-243): a fake notification source and
 * fake stream sinks, so payload validation, the admin-only channel, the per-user stream limit, the
 * heartbeat, the slow-consumer drop, the heartbeat recheck, the lifetime cap and closeSession
 * (PR #25 review L2) are shown without Postgres or sockets.
 */
import { Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { EventHub, type EventSink, type HubLogger, MAX_STREAM_LIFETIME_MS } from "../src/events/hub.js";
import type { NotificationListener, NotificationSource } from "../src/events/source.js";

class FakeSource implements NotificationSource {
  private listeners: NotificationListener[] = [];
  closed = false;

  subscribe(listener: NotificationListener): () => void {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((existing) => existing !== listener);
    };
  }

  emit(channel: string, payload: unknown): void {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    for (const listener of this.listeners) {
      listener(channel, text);
    }
  }

  listenerCount(): number {
    return this.listeners.length;
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

/** A sink that takes every chunk at once, like a client reading promptly. */
class HealthySink implements EventSink {
  chunks: string[] = [];
  ended = false;
  readonly writableLength = 0;

  write(chunk: string): boolean {
    this.chunks = [...this.chunks, chunk];
    return true;
  }

  end(): void {
    this.ended = true;
  }

  destroy(): void {
    this.ended = true;
  }

  text(): string {
    return this.chunks.join("");
  }
}

/** A writable whose consumer never reads: every write stays queued in writableLength. */
function neverDrainingSink(): Writable {
  return new Writable({
    highWaterMark: 16,
    // Never calls back, so nothing queued is ever flushed.
    write: () => undefined,
  });
}

/** A logger whose warn calls a spy, so tests can assert on what was logged. */
function spyLogger(): HubLogger & { warn: HubLogger["warn"]; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn();
  return {
    spy,
    warn: (...args: unknown[]) => {
      spy(...args);
    },
    info: () => undefined,
  };
}

const COVERAGE = { config_id: "cfg_6_online_100", pair: "BB-BTN", flop: "KhQd4s", build_id: "b1", scenario_count: 12 };
const PROGRESS = { job_id: "j1", line: "r250.c", iteration: 400, exploitability: [0.5, 0.25] };
const STATE = { state: "throttled", reason: "outside the overnight window" };

/** The identity of a non-admin stream for a user and session. */
function member(userId: string, sessionId: string): { userId: string; sessionId: string; isAdmin: boolean } {
  return { userId, sessionId, isAdmin: false };
}

describe("R3.4 event hub", () => {
  let hub: EventHub | undefined;

  afterEach(() => {
    hub?.close();
    hub = undefined;
  });

  it("R3.4 writes the retry line, then each valid event as event and data lines", () => {
    const source = new FakeSource();
    hub = new EventHub(source, spyLogger());
    const sink = new HealthySink();
    hub.open({ userId: "u1", sessionId: "s-u1", isAdmin: false, sink });

    source.emit("coverage_added", COVERAGE);
    source.emit("builder_state", STATE);

    expect(sink.text()).toBe(
      `retry: 5000\n\nevent: coverage_added\ndata: ${JSON.stringify(COVERAGE)}\n\n` +
        `event: builder_state\ndata: ${JSON.stringify(STATE)}\n\n`,
    );
  });

  it("R3.5 remembers the last builder_state, and null before any", () => {
    const source = new FakeSource();
    hub = new EventHub(source, spyLogger());
    expect(hub.lastBuilderState()).toBeNull();

    source.emit("builder_state", STATE);
    source.emit("builder_state", { state: "idle", reason: "nothing claimable" });

    expect(hub.lastBuilderState()).toEqual({ state: "idle", reason: "nothing claimable" });
  });

  it("R3.4 sends build_progress to admins only", () => {
    const source = new FakeSource();
    hub = new EventHub(source, spyLogger());
    const member = new HealthySink();
    const admin = new HealthySink();
    hub.open({ userId: "member", sessionId: "s-member", isAdmin: false, sink: member });
    hub.open({ userId: "admin", sessionId: "s-admin", isAdmin: true, sink: admin });

    source.emit("build_progress", PROGRESS);
    source.emit("build_progress", { ...PROGRESS, exploitability: null });

    expect(member.text()).not.toContain("build_progress");
    expect(admin.text()).toContain(`event: build_progress\ndata: ${JSON.stringify(PROGRESS)}\n\n`);
    expect(admin.text()).toContain('"exploitability":null');
  });

  it("R3.4 drops a malformed payload or an unknown channel with a warn log", () => {
    const source = new FakeSource();
    const log = spyLogger();
    hub = new EventHub(source, log);
    const sink = new HealthySink();
    hub.open({ userId: "u1", sessionId: "s-u1", isAdmin: true, sink });

    source.emit("coverage_added", "{not json");
    source.emit("coverage_added", { ...COVERAGE, scenario_count: "many" });
    source.emit("builder_state", { state: "exploded", reason: "x" });
    source.emit("build_progress", { job_id: "j1" });
    source.emit("session_nudge", { anything: true });

    expect(sink.text()).toBe("retry: 5000\n\n");
    expect(log.spy).toHaveBeenCalledTimes(5);
    expect(hub.lastBuilderState()).toBeNull();
  });

  it("R3.4 allows at most 4 open streams per user and frees a slot when one closes", () => {
    hub = new EventHub(null, spyLogger());
    const streams = [1, 2, 3, 4].map(() => hub?.open({ userId: "u1", sessionId: "s-u1", isAdmin: false, sink: new HealthySink() }));

    expect(hub.hasRoom("u1")).toBe(false);
    expect(hub.hasRoom("u2")).toBe(true);
    expect(() => hub?.open({ userId: "u1", sessionId: "s-u1", isAdmin: false, sink: new HealthySink() })).toThrow(/streams/);

    streams[0]?.close();
    streams[0]?.close();
    expect(hub.streamCount("u1")).toBe(3);
    expect(hub.hasRoom("u1")).toBe(true);
  });

  it("R3.4 ends a slow consumer's stream and keeps the healthy one receiving", () => {
    const source = new FakeSource();
    const log = spyLogger();
    hub = new EventHub(source, log, { maxQueuedBytes: 1024 });
    const slow = neverDrainingSink();
    const healthy = new HealthySink();
    hub.open({ userId: "slow", sessionId: "s-slow", isAdmin: false, sink: slow });
    hub.open({ userId: "fine", sessionId: "s-fine", isAdmin: false, sink: healthy });

    const events = 40;
    for (let index = 0; index < events; index += 1) {
      source.emit("coverage_added", { ...COVERAGE, scenario_count: index });
    }

    expect(hub.streamCount("slow")).toBe(0);
    expect(slow.destroyed).toBe(true);
    expect(slow.writableLength).toBeLessThanOrEqual(1024);
    expect(hub.streamCount("fine")).toBe(1);
    expect(healthy.text().match(/event: coverage_added/g)).toHaveLength(events);
    expect(log.spy).toHaveBeenCalledWith(expect.objectContaining({ userId: "slow" }), expect.any(String));
  });

  it("R3.4 writes a heartbeat comment on the heartbeat interval", async () => {
    vi.useFakeTimers();
    try {
      hub = new EventHub(null, spyLogger(), { heartbeatMs: 1000 });
      const sink = new HealthySink();
      hub.open({ userId: "u1", sessionId: "s-u1", isAdmin: false, sink });

      await vi.advanceTimersByTimeAsync(2500);

      expect(sink.text()).toBe("retry: 5000\n\n: heartbeat\n\n: heartbeat\n\n");
    } finally {
      vi.useRealTimers();
    }
  });

  it("R3.4 re-checks each stream at the heartbeat and ends one whose session is no longer live (PR #25 L2)", async () => {
    vi.useFakeTimers();
    try {
      hub = new EventHub(null, spyLogger(), { heartbeatMs: 1000 });
      let live = true;
      const ending = new HealthySink();
      const other = new HealthySink();
      hub.open({ ...member("u1", "s1"), sink: ending, recheck: () => Promise.resolve({ live, isAdmin: false }) });
      hub.open({ ...member("u1", "s2"), sink: other, recheck: () => Promise.resolve({ live: true, isAdmin: false }) });

      await vi.advanceTimersByTimeAsync(1000);
      expect(ending.ended).toBe(false);

      live = false;
      await vi.advanceTimersByTimeAsync(1000);

      expect(ending.ended).toBe(true);
      expect(other.ended).toBe(false);
      expect(hub.streamCount("u1")).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("R3.4 stops sending build_progress to a stream whose admin flag was revoked (PR #25 L2)", async () => {
    vi.useFakeTimers();
    try {
      const source = new FakeSource();
      hub = new EventHub(source, spyLogger(), { heartbeatMs: 1000 });
      let isAdmin = true;
      const sink = new HealthySink();
      hub.open({ ...member("admin", "s1"), isAdmin: true, sink, recheck: () => Promise.resolve({ live: true, isAdmin }) });

      source.emit("build_progress", PROGRESS);
      isAdmin = false;
      await vi.advanceTimersByTimeAsync(1000);
      source.emit("build_progress", { ...PROGRESS, job_id: "after-revoke" });
      source.emit("coverage_added", COVERAGE);

      expect(sink.text()).toContain(`"job_id":"${PROGRESS.job_id}"`);
      expect(sink.text()).not.toContain("after-revoke");
      expect(sink.text()).toContain("event: coverage_added");
      expect(sink.ended).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("R3.4 ends a stream at the first heartbeat after its lifetime cap (PR #25 L2)", async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      hub = new EventHub(null, spyLogger(), { heartbeatMs: 1000, maxLifetimeMs: 2500, now: () => now });
      const sink = new HealthySink();
      hub.open({ ...member("u1", "s1"), sink });

      now = 2000;
      await vi.advanceTimersByTimeAsync(1000);
      expect(sink.ended).toBe(false);

      now = 2500;
      await vi.advanceTimersByTimeAsync(1000);
      expect(sink.ended).toBe(true);
      expect(hub.streamCount()).toBe(0);
      expect(MAX_STREAM_LIFETIME_MS).toBe(60 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("R3.4 keeps a stream and logs a warning when its re-check fails, and never runs two at once", async () => {
    vi.useFakeTimers();
    try {
      const log = spyLogger();
      hub = new EventHub(null, log, { heartbeatMs: 1000 });
      const sink = new HealthySink();
      let calls = 0;
      let release: () => void = () => undefined;
      const pending = new Promise<never>((_resolve, reject) => {
        release = () => {
          reject(new Error("database unavailable"));
        };
      });
      hub.open({
        ...member("u1", "s1"),
        sink,
        recheck: () => {
          calls += 1;
          return pending;
        },
      });

      await vi.advanceTimersByTimeAsync(3000);
      expect(calls).toBe(1);
      release();
      await vi.advanceTimersByTimeAsync(0);

      expect(sink.ended).toBe(false);
      expect(hub.streamCount("u1")).toBe(1);
      expect(log.spy).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }), expect.stringContaining("re-check"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("R3.4 closeSession ends that session's streams only (logout, PR #25 L2)", () => {
    hub = new EventHub(null, spyLogger());
    const loggedOut = [new HealthySink(), new HealthySink()];
    const otherDevice = new HealthySink();
    for (const sink of loggedOut) {
      hub.open({ ...member("u1", "s1"), sink });
    }
    hub.open({ ...member("u1", "s2"), sink: otherDevice });

    expect(hub.closeSession("s1")).toBe(2);

    expect(loggedOut.every((sink) => sink.ended)).toBe(true);
    expect(otherDevice.ended).toBe(false);
    expect(hub.streamCount("u1")).toBe(1);
    expect(hub.closeSession("s1")).toBe(0);
  });

  it("R3.4 close ends every stream and unsubscribes from the source", () => {
    const source = new FakeSource();
    hub = new EventHub(source, spyLogger());
    const sink = new HealthySink();
    hub.open({ userId: "u1", sessionId: "s-u1", isAdmin: false, sink });
    expect(source.listenerCount()).toBe(1);

    hub.close();

    expect(sink.ended).toBe(true);
    expect(hub.streamCount()).toBe(0);
    expect(source.listenerCount()).toBe(0);
    expect(source.closed).toBe(false);
  });
});
