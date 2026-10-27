/**
 * Where database notifications come from (R3.4, R3.5, A4 section 4, O-243). buildApp takes a
 * NotificationSource so tests can drive the event stream without Postgres; main.ts passes the
 * LISTEN connection lane C builds over pg. A source delivers the raw channel and payload text; the
 * event hub parses and validates each payload before any client sees it.
 */
import "fastify";

declare module "fastify" {
  interface FastifyInstance {
    notifications: NotificationSource | null;
  }
}

export type NotificationListener = (channel: string, payload: string) => void;

export interface NotificationSource {
  /** Adds a listener; returns the function that removes it. */
  subscribe(listener: NotificationListener): () => void;
  /** Stops listening and releases the connection. */
  close(): Promise<void>;
}

/** The LISTEN channels the api relays (A4 section 4). */
export const NOTIFY_CHANNELS = ["coverage_added", "builder_state", "build_progress"] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];
