/**
 * The event hub at unit level (R3.4, R3.5, A4 section 4, O-243): a fake notification source and
 * fake stream sinks, so payload validation, the admin-only channel, the per-user stream limit, the
 * heartbeat and the slow-consumer drop are shown without Postgres or sockets.
 */
import { Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { EventHub, type EventSink, type HubLogger } from "../src/events/hub.js";
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
    hub.open({ userId: "u1", isAdmin: false, sink });

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
    hub.open({ userId: "member", isAdmin: false, sink: member });
    hub.open({ userId: "admin", isAdmin: true, sink: admin });

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
    hub.open({ userId: "u1", isAdmin: true, sink });

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
    const streams = [1, 2, 3, 4].map(() => hub?.open({ userId: "u1", isAdmin: false, sink: new HealthySink() }));

    expect(hub.hasRoom("u1")).toBe(false);
    expect(hub.hasRoom("u2")).toBe(true);
    expect(() => hub?.open({ userId: "u1", isAdmin: false, sink: new HealthySink() })).toThrow(/streams/);

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
    hub.open({ userId: "slow", isAdmin: false, sink: slow });
    hub.open({ userId: "fine", isAdmin: false, sink: healthy });

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
      hub.open({ userId: "u1", isAdmin: false, sink });

      await vi.advanceTimersByTimeAsync(2500);

      expect(sink.text()).toBe("retry: 5000\n\n: heartbeat\n\n: heartbeat\n\n");
    } finally {
      vi.useRealTimers();
    }
  });

  it("R3.4 close ends every stream and unsubscribes from the source", () => {
    const source = new FakeSource();
    hub = new EventHub(source, spyLogger());
    const sink = new HealthySink();
    hub.open({ userId: "u1", isAdmin: false, sink });
    expect(source.listenerCount()).toBe(1);

    hub.close();

    expect(sink.ended).toBe(true);
    expect(hub.streamCount()).toBe(0);
    expect(source.listenerCount()).toBe(0);
    expect(source.closed).toBe(false);
  });
});
