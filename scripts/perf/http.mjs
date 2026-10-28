// The http client of just perf (R3.3, O-248): one request at a time through Caddy, with the
// session cookie and the CSRF (cross-site request forgery) token a browser would send.
//
// Trust: Caddy serves `tls internal`, a certificate signed by its own root. The transport passes
// that one root as the `ca` option of node:https, so only these requests trust it, certificate
// checks stay on, and no process-wide setting (NODE_TLS_REJECT_UNAUTHORIZED, NODE_EXTRA_CA_CERTS)
// is touched. scripts/perf/stack.mjs copies the root out of the caddy container.
//
// Pacing: the api allows 300 requests per client address per minute (GLOBAL_RATE_LIMIT_MAX,
// services/api/src/http/rate-limits.ts), and a run makes about 700. The client starts requests at
// least REQUEST_INTERVAL_MS apart, 240 a minute, so the limit is never reached; a 429 is refused
// rather than timed or retried, since a throttled sample is not a latency. Pacing also keeps
// requests from queueing behind each other, so every sample is one request on an idle stack.
//
// A sample's time is performance.now() from just before the request is sent until its whole body
// has arrived: the client round trip the O-40 limits describe.

import https from "node:https";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { PerfError } from "./errors.mjs";

/** 60,000 ms / 240 requests: below the api's 300 a minute with room for the setup requests. */
export const REQUEST_INTERVAL_MS = 250;
export const REQUEST_TIMEOUT_MS = 30_000;
const TOO_MANY_REQUESTS = 429;
const CSRF_HEADER = "x-csrf-token";
const IDEMPOTENCY_HEADER = "idempotency-key";
const SET_COOKIE_HEADER = "set-cookie";
const COOKIE_PAIR = /^\s*([^=;\s]+)=([^;]*)/;
const READ_METHODS = new Set(["GET", "HEAD"]);
const JSON_TYPE = "application/json";

/** A transport over node:https that trusts exactly the PEM root `ca`. */
export function httpsTransport(ca) {
  return ({ method, url, headers, body }) =>
    new Promise((resolvePromise, reject) => {
      const request = https.request(url, { method, headers, ca, timeout: REQUEST_TIMEOUT_MS }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () =>
          resolvePromise({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
      });
      request.on("timeout", () => request.destroy(new Error(`no response within ${REQUEST_TIMEOUT_MS} ms`)));
      request.on("error", reject);
      request.end(body);
    });
}

function cookiesFrom(headers) {
  const raw = headers[SET_COOKIE_HEADER];
  const lines = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return lines.map((line) => COOKIE_PAIR.exec(line)).filter((match) => match !== null).map((match) => [match[1], match[2]]);
}

function requestHeaders({ method, body, origin, cookies, csrfToken, idempotencyKey }) {
  const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  const mutating = !READ_METHODS.has(method);
  return {
    accept: JSON_TYPE,
    ...(body === undefined ? {} : { "content-type": JSON_TYPE }),
    ...(cookie === "" ? {} : { cookie }),
    ...(mutating ? { origin } : {}),
    ...(mutating && csrfToken !== null ? { [CSRF_HEADER]: csrfToken } : {}),
    ...(idempotencyKey === undefined ? {} : { [IDEMPOTENCY_HEADER]: idempotencyKey }),
  };
}

/**
 * A client of the api at `baseUrl`. request(method, path, { body, idempotencyKey }) resolves to
 * { status, headers, body, ms }; a transport failure is rethrown as a PerfError naming the path.
 */
export function createApiClient({ baseUrl, transport, minIntervalMs = REQUEST_INTERVAL_MS, now = () => performance.now(), sleep = delay }) {
  const origin = new URL(baseUrl).origin;
  let cookies = new Map();
  let csrfToken = null;
  let lastStart = null;

  async function pace() {
    if (lastStart === null) return;
    const wait = lastStart + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
  }

  async function request(method, path, { body, idempotencyKey } = {}) {
    await pace();
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = requestHeaders({ method, body: payload, origin, cookies, csrfToken, idempotencyKey });
    const started = now();
    lastStart = started;
    let response;
    try {
      response = await transport({ method, url: new URL(path, origin).href, headers, body: payload });
    } catch (error) {
      throw new PerfError(`${method} ${path} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const ms = now() - started;
    if (response.status === TOO_MANY_REQUESTS) {
      throw new PerfError(`${method} ${path} answered 429: the api rate limit was reached; raise REQUEST_INTERVAL_MS`);
    }
    cookies = new Map([...cookies, ...cookiesFrom(response.headers)]);
    return { ...response, ms };
  }

  return {
    request,
    setCsrfToken(token) {
      csrfToken = token;
    },
  };
}
