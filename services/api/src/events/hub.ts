/**
 * The in-process event hub behind GET /events (R3.4, R3.5, A4 section 4, O-243). One hub per app
 * subscribes once to the notification source, validates every payload (payloads.ts), remembers
 * the last builder_state for GET /admin/builder, and fans each event out to the open streams as
 * server-sent events. There is no replay: a client that reconnects refetches what it shows.
 *
 * Mechanism:
 * - A stream is a sink (the hijacked response) plus its user and admin flag. build_progress goes
 *   to admin streams only; coverage_added and builder_state go to every stream.
 * - Each user may hold at most MAX_STREAMS_PER_USER streams; the route asks hasRoom before it
 *   hijacks the reply, so the refused request still answers a normal 429 problem.
 * - Slow consumers: before each write the hub looks at the sink's queued bytes (writableLength).
 *   When the write would take it past maxQueuedBytes, the hub destroys that stream and drops it
 *   with a warn log instead of buffering without bound; the other streams are unaffected.
 * - One heartbeat timer writes a comment line to every stream every heartbeatMs, so proxies and
 *   browsers keep an idle stream open. It runs only while a stream is open and never keeps the
 *   process alive on its own.
 */
import type { FastifyBaseLogger } from "fastify";

import { ADMIN_ONLY_CHANNELS, type BuilderStatePayload, type ParsedEvent, parseNotification } from "./payloads.js";
import type { NotificationSource } from "./source.js";

/** At most this many open streams per user (O-243). */
export const MAX_STREAMS_PER_USER = 4;
/** Milliseconds between heartbeat comments (O-243). */
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** The reconnect delay the stream tells the browser, in milliseconds (O-243). */
export const SSE_RETRY_MS = 5000;
/** Bytes a stream may have queued on its socket before the hub ends it as a slow consumer. */
export const MAX_QUEUED_BYTES_PER_STREAM = 256 * 1024;

const HEARTBEAT_COMMENT = ": heartbeat\n\n";

export type HubLogger = Pick<FastifyBaseLogger, "warn" | "info">;

/** Where a stream's bytes go: the hijacked response in production, a fake in unit tests. */
export interface EventSink {
  write(chunk: string): boolean;
  readonly writableLength: number;
  end(): void;
  destroy(): void;
}

export interface StreamRequest {
  userId: string;
  isAdmin: boolean;
  sink: EventSink;
}

export interface EventStream {
  /** Unregisters the stream; safe to call more than once. Does not end the sink. */
  close(): void;
}

export interface HubOptions {
  maxStreamsPerUser: number;
  maxQueuedBytes: number;
  heartbeatMs: number;
  retryMs: number;
}

const DEFAULT_OPTIONS: HubOptions = {
  maxStreamsPerUser: MAX_STREAMS_PER_USER,
  maxQueuedBytes: MAX_QUEUED_BYTES_PER_STREAM,
  heartbeatMs: HEARTBEAT_INTERVAL_MS,
  retryMs: SSE_RETRY_MS,
};

/** The open stream limit was reached; the route answers 429 before this can happen. */
export class TooManyStreamsError extends Error {
  constructor(limit: number) {
    super(`at most ${limit} open event streams per user`);
    this.name = "TooManyStreamsError";
  }
}

/** One server-sent event: the channel as the event name and the validated payload as data. */
export function formatEvent(event: ParsedEvent): string {
  return `event: ${event.channel}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

type Registered = Readonly<StreamRequest> & { readonly id: number };

export class EventHub {
  private readonly options: HubOptions;
  private readonly unsubscribe: () => void;
  private streams: ReadonlyMap<number, Registered> = new Map();
  private nextId = 1;
  private heartbeat: NodeJS.Timeout | null = null;
  private lastState: BuilderStatePayload | null = null;

  constructor(
    source: NotificationSource | null,
    private readonly log: HubLogger,
    options: Partial<HubOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.unsubscribe =
      source === null
        ? () => undefined
        : source.subscribe((channel, payload) => {
            this.deliver(channel, payload);
          });
  }

  /** The last builder_state seen since the hub started, or null. */
  lastBuilderState(): BuilderStatePayload | null {
    return this.lastState;
  }

  /** Open streams, of one user or of everyone. */
  streamCount(userId?: string): number {
    const all = [...this.streams.values()];
    return userId === undefined ? all.length : all.filter((stream) => stream.userId === userId).length;
  }

  hasRoom(userId: string): boolean {
    return this.streamCount(userId) < this.options.maxStreamsPerUser;
  }

  /** Registers a stream and writes the retry line; throws TooManyStreamsError at the limit. */
  open(request: StreamRequest): EventStream {
    if (!this.hasRoom(request.userId)) {
      throw new TooManyStreamsError(this.options.maxStreamsPerUser);
    }
    const registered: Registered = { ...request, id: this.nextId };
    this.nextId += 1;
    this.streams = new Map([...this.streams, [registered.id, registered]]);
    this.startHeartbeat();
    this.write(registered, `retry: ${this.options.retryMs}\n\n`);
    return { close: () => this.remove(registered.id) };
  }

  /** Unsubscribes from the source and ends every open stream. */
  close(): void {
    this.unsubscribe();
    const open = [...this.streams.values()];
    this.streams = new Map();
    this.stopHeartbeat();
    for (const stream of open) {
      stream.sink.end();
    }
  }

  private deliver(channel: string, payload: string): void {
    const outcome = parseNotification(channel, payload);
    if (!outcome.ok) {
      this.log.warn({ channel, reason: outcome.reason }, "dropped a malformed notification");
      return;
    }
    const { event } = outcome;
    if (event.channel === "builder_state") {
      this.lastState = event.data;
    }
    const chunk = formatEvent(event);
    const adminOnly = ADMIN_ONLY_CHANNELS.has(event.channel);
    for (const stream of this.streams.values()) {
      if (!adminOnly || stream.isAdmin) {
        this.write(stream, chunk);
      }
    }
  }

  private write(stream: Registered, chunk: string): void {
    const queued = stream.sink.writableLength + Buffer.byteLength(chunk, "utf8");
    if (queued > this.options.maxQueuedBytes) {
      this.log.warn(
        { userId: stream.userId, queuedBytes: stream.sink.writableLength },
        "ended a slow event stream consumer",
      );
      this.remove(stream.id);
      stream.sink.destroy();
      return;
    }
    stream.sink.write(chunk);
  }

  private remove(id: number): void {
    if (!this.streams.has(id)) {
      return;
    }
    this.streams = new Map([...this.streams].filter(([key]) => key !== id));
    if (this.streams.size === 0) {
      this.stopHeartbeat();
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeat !== null) {
      return;
    }
    this.heartbeat = setInterval(() => {
      for (const stream of this.streams.values()) {
        this.write(stream, HEARTBEAT_COMMENT);
      }
    }, this.options.heartbeatMs);
    this.heartbeat.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}
