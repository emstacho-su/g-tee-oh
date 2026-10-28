/**
 * The Postgres notification source (R3.4, A4 section 4, O-243): one dedicated pg.Client per api
 * process that LISTENs on coverage_added, builder_state and build_progress and hands each
 * notification's channel and raw payload to its listeners (the event hub validates them).
 *
 * Mechanism: the client is separate from the Kysely pool, because a LISTEN belongs to one session
 * and a pooled connection would be handed to other queries. On an error or an end of the
 * connection (a restart of Postgres, pg_terminate_backend, a network drop) the source logs it,
 * drops that client and connects a new one after an exponential backoff: INITIAL_BACKOFF_MS,
 * doubling per failed attempt up to MAX_BACKOFF_MS, and back to the initial delay after a
 * successful connect. Each new client LISTENs again on every channel. Notifications sent while no
 * client listens are lost; the stream has no replay, and clients refetch on reconnect (O-243).
 * close() stops reconnecting and ends the client. It connects as the app login: LISTEN needs no
 * grant.
 */
import pg from "pg";

import type { HubLogger } from "./hub.js";
import { NOTIFY_CHANNELS, type NotificationListener, type NotificationSource } from "./source.js";

/** The first reconnect delay, in milliseconds. */
export const INITIAL_BACKOFF_MS = 500;
/** The longest reconnect delay, in milliseconds. */
export const MAX_BACKOFF_MS = 30_000;
/** The application_name the LISTEN connection shows in pg_stat_activity. */
export const LISTEN_APPLICATION_NAME = "g-tee-oh-api-listen";

const BACKOFF_FACTOR = 2;

export interface PgSourceOptions {
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

/** The delay before reconnect attempt `attempt` (0 for the first): doubling, capped. */
export function backoffDelayMs(attempt: number, initialMs: number, maxMs: number): number {
  return Math.min(initialMs * BACKOFF_FACTOR ** attempt, maxMs);
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

export class PgNotificationSource implements NotificationSource {
  private listeners: readonly NotificationListener[] = [];
  private client: pg.Client | null = null;
  private log: HubLogger | null = null;
  private attempt = 0;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  private waiters: readonly Waiter[] = [];
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(
    private readonly connection: pg.ClientConfig,
    options: PgSourceOptions = {},
  ) {
    this.initialBackoffMs = options.initialBackoffMs ?? INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? MAX_BACKOFF_MS;
  }

  subscribe(listener: NotificationListener): () => void {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((existing) => existing !== listener);
    };
  }

  /** Starts connecting in the background; a failure is logged and retried, never thrown. */
  start(log: HubLogger): void {
    if (this.log !== null || this.closed) {
      return;
    }
    this.log = log;
    void this.connect();
  }

  /** Resolves once a client is listening (at once if one already is); rejects on close. */
  whenListening(): Promise<void> {
    if (this.client !== null) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.waiters = [...this.waiters, { resolve, reject }];
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      waiter.reject(new Error("the notification source was closed"));
    }
    const client = this.client;
    this.client = null;
    if (client !== null) {
      await client.end();
    }
  }

  private async connect(): Promise<void> {
    const client = new pg.Client(this.connection);
    client.on("notification", (message) => {
      this.emit(message.channel, message.payload ?? "");
    });
    client.on("error", (error) => {
      this.lost(client, error);
    });
    client.on("end", () => {
      this.lost(client, null);
    });
    try {
      await client.connect();
      // The channel names are fixed identifiers (source.ts NOTIFY_CHANNELS), never request input.
      for (const channel of NOTIFY_CHANNELS) {
        await client.query(`listen ${channel}`);
      }
    } catch (error: unknown) {
      this.log?.warn({ err: error, attempt: this.attempt }, "could not LISTEN for notifications; retrying");
      await this.endAfterFailure(client);
      this.scheduleReconnect();
      return;
    }
    this.listening(client);
  }

  private listening(client: pg.Client): void {
    if (this.closed) {
      void this.endAfterFailure(client);
      return;
    }
    this.client = client;
    this.attempt = 0;
    this.log?.info({ channels: [...NOTIFY_CHANNELS] }, "listening for notifications");
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      waiter.resolve();
    }
  }

  private lost(client: pg.Client, error: Error | null): void {
    if (client !== this.client) {
      return;
    }
    this.client = null;
    this.log?.warn({ err: error }, "lost the LISTEN connection; reconnecting");
    void this.endAfterFailure(client);
    this.scheduleReconnect();
  }

  /** Ends a failed client; a failure to end it is logged, since the client is dropped anyway. */
  private async endAfterFailure(client: pg.Client): Promise<void> {
    try {
      await client.end();
    } catch (error: unknown) {
      this.log?.warn({ err: error }, "could not end a failed LISTEN connection");
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.timer !== null) {
      return;
    }
    const delay = backoffDelayMs(this.attempt, this.initialBackoffMs, this.maxBackoffMs);
    this.attempt += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, delay);
    this.timer.unref();
  }

  private emit(channel: string, payload: string): void {
    for (const listener of this.listeners) {
      try {
        listener(channel, payload);
      } catch (error: unknown) {
        this.log?.warn({ err: error, channel }, "a notification listener failed");
      }
    }
  }
}

/** The source for one connection; call start(log) to begin listening. */
export function createPgNotificationSource(
  connection: pg.ClientConfig,
  options: PgSourceOptions = {},
): PgNotificationSource {
  return new PgNotificationSource(connection, options);
}
