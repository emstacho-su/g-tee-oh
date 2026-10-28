/**
 * The api's solver-query client (R3.3, O-158, O-244): status mapping without relaying upstream
 * bodies, the request id on every call, 503 when unconfigured, and the fixture binary answering.
 */
import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { ProblemError } from "../src/http/problem.js";
import {
  createSolverQuery,
  expectData,
  requireSolverQuery,
  REQUEST_ID_HEADER,
  upstreamHeaders,
  withTimeout,
} from "../src/solver-query/client.js";
import { fixtureSolverQuery } from "./support/solver-query.js";

const BASE = "http://solver-query.test:7070";
const SECRET_DETAIL = "internal path /srv/library/abc";

function answering(status: number, body: unknown, seen: Request[] = []): typeof fetch {
  return (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    seen.push(request);
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    );
  };
}

async function problemOf(promise: Promise<unknown>): Promise<ProblemError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ProblemError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a ProblemError");
}

describe("R3.3 solver-query client", () => {
  it("R3.3 maps upstream statuses to api problems and never relays the upstream detail", async () => {
    const cases: Array<[number, number, string]> = [
      [400, 400, "bad-request"],
      [404, 404, "not-found"],
      [503, 503, "unavailable"],
      [500, 502, "upstream"],
      [429, 502, "upstream"],
    ];
    for (const [upstream, status, slug] of cases) {
      const client = createSolverQuery(BASE, { fetch: answering(upstream, { detail: SECRET_DETAIL }) });
      const problem = await problemOf(expectData(client.GET("/healthz"), "this node"));
      expect([problem.status, problem.slug], String(upstream)).toEqual([status, slug]);
      expect(problem.detail ?? "").not.toContain(SECRET_DETAIL);
    }
  });

  it("R3.3 a network failure is a 502 problem", async () => {
    const failing: typeof fetch = () => Promise.reject(new TypeError("connect ECONNREFUSED"));
    const client = createSolverQuery(BASE, { fetch: failing });
    const problem = await problemOf(expectData(client.GET("/healthz"), "the health probe"));
    expect([problem.status, problem.slug]).toEqual([502, "upstream"]);
  });

  it("R3.3 a call that outlasts the timeout is aborted and answers the generic 502 (PR #25 M1)", async () => {
    let aborted = false;
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted by the timeout"));
        });
      });
    const client = createSolverQuery(BASE, { fetch: hanging, timeoutMs: 20 });
    const started = performance.now();
    const problem = await problemOf(expectData(client.GET("/healthz"), "the health probe"));
    expect([problem.status, problem.slug]).toEqual([502, "upstream"]);
    expect(aborted).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("R3.3 the timeout keeps a caller's own abort signal (PR #25 M1)", async () => {
    const controller = new AbortController();
    const seen: Array<AbortSignal | null | undefined> = [];
    const wrapped = withTimeout((_input, init) => {
      seen.push(init?.signal);
      return Promise.resolve(new Response("{}"));
    }, 1000);
    await wrapped("http://x.test/", { signal: controller.signal });
    controller.abort();
    expect(seen[0]?.aborted).toBe(true);
  });

  it("R3.3 a success returns the body and carries the request id (O-158)", async () => {
    const seen: Request[] = [];
    const client = createSolverQuery(BASE, { fetch: answering(200, { status: "ok" }, seen) });
    const headers = upstreamHeaders({ id: "req-123" } as Parameters<typeof upstreamHeaders>[0]);
    const body = await expectData(client.GET("/healthz", { headers }), "the health probe");
    expect(body).toMatchObject({ status: "ok" });
    expect(seen[0]?.headers.get(REQUEST_ID_HEADER)).toBe("req-123");
  });

  it("R3.3 an app built without solver-query answers 503 where a handler needs it", () => {
    const app = buildApp();
    expect(() => requireSolverQuery(app)).toThrow(ProblemError);
  });

  it("R3.3 the fixture solver-query binary answers /healthz (O-53, O-244)", async () => {
    const client = fixtureSolverQuery();
    const health = await expectData(client.GET("/healthz"), "the health probe");
    expect(health).toHaveProperty("status");
  });
});
