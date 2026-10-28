/**
 * Test helpers for GET /events over a real port (R3.4): a browser-like stream reader over fetch
 * and polling waits. Shared by events-stream, events-abort and events-recheck.
 */
import type { ReadableStreamDefaultReader, ReadableStreamReadResult } from "node:stream/web";

import type { FastifyInstance } from "fastify";

import { sessionCookie } from "./support/app.js";
import type { TestSession } from "./support/database.js";

export const WAIT_TIMEOUT_MS = 10_000;
const POLL_MS = 20;
export const RETRY_LINE = "retry: 5000\n\n";

/** Polls until the condition holds; throws naming what it waited for after WAIT_TIMEOUT_MS. */
export async function waitUntil(condition: () => boolean, what: string | (() => string)): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${typeof what === "string" ? what : what()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function openConnections(app: FastifyInstance): Promise<number> {
  return new Promise((resolve, reject) => {
    app.server.getConnections((error, count) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(count);
    });
  });
}

/** Waits until the server holds at most `count` client connections. */
export async function waitForConnections(app: FastifyInstance, count: number): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while ((await openConnections(app)) > count) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for the server to hold at most ${count} connections`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** A browser-like event stream reader over fetch. */
export class StreamClient {
  text = "";
  /** True once the server ended the response body. */
  ended = false;
  private readonly decoder = new TextDecoder();

  private constructor(
    readonly response: Response,
    private readonly controller: AbortController,
  ) {}

  static async open(url: string, session: Pick<TestSession, "token">): Promise<StreamClient> {
    const controller = new AbortController();
    const response = await fetch(url, { headers: { cookie: sessionCookie(session) }, signal: controller.signal });
    const client = new StreamClient(response, controller);
    if (response.ok) {
      client.pump();
      await client.waitFor(RETRY_LINE);
    }
    return client;
  }

  private pump(): void {
    const body = this.response.body;
    if (body === null) {
      throw new Error("the event stream has no body");
    }
    const reader = body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const read = async (): Promise<void> => {
      for (;;) {
        const chunk: ReadableStreamReadResult<Uint8Array> = await reader.read();
        if (chunk.done) {
          this.ended = true;
          return;
        }
        this.text += this.decoder.decode(chunk.value, { stream: true });
      }
    };
    read().catch((error: unknown) => {
      if (!(error instanceof Error && error.name === "AbortError")) {
        throw error;
      }
    });
  }

  async waitFor(fragment: string): Promise<void> {
    await waitUntil(
      () => this.text.includes(fragment),
      () => `${JSON.stringify(fragment)}; received ${JSON.stringify(this.text)}`,
    );
  }

  /** How many heartbeat comments have arrived. */
  heartbeats(): number {
    return this.text.split(": heartbeat\n\n").length - 1;
  }

  close(): void {
    this.controller.abort();
  }
}
