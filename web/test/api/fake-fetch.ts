/**
 * Test helper: an injected fake fetch for the api client (R3.13). It answers from a script of
 * responses keyed by "METHOD /path", records every request it sees (method, path, the
 * x-csrf-token header and the body text) and never opens a socket. Each key holds a queue of
 * response factories; the last factory repeats once the queue runs dry, so a test scripts only
 * what differs. An unscripted request answers 599 so a missing script fails loudly.
 */
import { fixtureSession } from "../../src/fixtures/index.js";
import type { SessionInfo } from "../../src/contracts.js";

export interface RecordedCall {
  method: string;
  path: string;
  csrf: string | null;
  body: string;
}

export type ResponseFactory = () => Response | Promise<Response>;
export type FetchScript = Readonly<Record<string, readonly ResponseFactory[]>>;

export interface FakeFetch {
  fetch: (input: Request) => Promise<Response>;
  calls: RecordedCall[];
  /** The "METHOD /path" keys in call order, the shortest way to assert a sequence. */
  keys: () => string[];
}

const UNSCRIPTED_STATUS = 599;
const PROBLEM_TYPE_PREFIX = "urn:g-tee-oh:problem:";

export function jsonResponse(status: number, body: unknown): ResponseFactory {
  return () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function problemResponse(status: number, slug: string, detail = "server detail text"): ResponseFactory {
  return () =>
    new Response(
      JSON.stringify({ type: `${PROBLEM_TYPE_PREFIX}${slug}`, title: `title of ${slug}`, status, detail }),
      { status, headers: { "content-type": "application/problem+json" } },
    );
}

/** A request that never reaches a server: fetch rejects with a TypeError, as browsers do. */
export function networkFailure(): ResponseFactory {
  return () => Promise.reject(new TypeError("Failed to fetch"));
}

export function noContent(): ResponseFactory {
  return () => new Response(null, { status: 204 });
}

export function sessionResponse(csrfToken: string = fixtureSession.csrf_token): ResponseFactory {
  const session: SessionInfo = { ...fixtureSession, csrf_token: csrfToken };
  return jsonResponse(200, session);
}

export function createFakeFetch(script: FetchScript): FakeFetch {
  const calls: RecordedCall[] = [];
  const served = new Map<string, number>();

  async function fakeFetch(input: Request): Promise<Response> {
    const url = new URL(input.url);
    const key = `${input.method} ${url.pathname}`;
    const body = await input.text();
    calls.push({ method: input.method, path: url.pathname, csrf: input.headers.get("x-csrf-token"), body });
    const queue = script[key];
    if (queue === undefined || queue.length === 0) {
      return new Response(`unscripted ${key}`, { status: UNSCRIPTED_STATUS });
    }
    const index = served.get(key) ?? 0;
    served.set(key, index + 1);
    const factory = queue[Math.min(index, queue.length - 1)] as ResponseFactory;
    return factory();
  }

  return { fetch: fakeFetch, calls, keys: () => calls.map((call) => `${call.method} ${call.path}`) };
}
