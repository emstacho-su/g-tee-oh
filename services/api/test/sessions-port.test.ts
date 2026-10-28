/**
 * The session's solver-query port and its fan-out (R3.6, ADR 0018, PR #25 review MEDIUM 3 and 5):
 * coverage reads run at most MAX_CONCURRENT_SOLVER_CALLS at a time, and a node read's 404 ends the
 * hand only when solver-query says the hand is outside the node's range; a solution or node the
 * library no longer holds is a 502, never silent play.
 */
import { describe, expect, it } from "vitest";

import { splitByCoverage } from "../src/sessions/candidates.js";
import { mapBounded, MAX_CONCURRENT_SOLVER_CALLS } from "../src/sessions/concurrency.js";
import { HAND_OFF_RANGE_TYPE, isHandOffRange, SESSION_DEADLINE_MS, solverPort, type SolverPort } from "../src/sessions/solver-port.js";
import { createSolverQuery } from "../src/solver-query/client.js";
import type { SqCoverage } from "../src/solver-query/client.js";
import type { FastifyRequest } from "fastify";

const CANDIDATES = 30;
const NOT_FOUND_TYPE = "urn:g-tee-oh:problem:not-found";

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1));
}

function coverageAnswer(available: boolean): SqCoverage {
  return { preflop: { available } } as unknown as SqCoverage;
}

describe("R3.6 bounded solver-query fan-out", () => {
  it("R3.6 splitByCoverage never has more than the cap of coverage calls in flight", async () => {
    let inFlight = 0;
    let most = 0;
    const port = {
      coverage: async (_config: string, pair: string) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await tick();
        inFlight -= 1;
        return coverageAnswer(pair.endsWith("0"));
      },
    } as unknown as SolverPort;
    const candidates = Array.from({ length: CANDIDATES }, (_, index) => ({ config_id: "cfg_6_online_100", pair: `P${index}` }));
    const split = await splitByCoverage(candidates, port);
    expect(most).toBe(MAX_CONCURRENT_SOLVER_CALLS);
    expect(split.covered.map((candidate) => candidate.pair)).toEqual(["P0", "P10", "P20"]);
    expect(split.gaps).toHaveLength(CANDIDATES - 3);
  });

  it("R3.6 mapBounded keeps input order and passes a rejection on", async () => {
    await expect(mapBounded([3, 1, 2], 2, async (value) => { await tick(); return value * 2; })).resolves.toEqual([6, 2, 4]);
    await expect(mapBounded([1, 2], 2, () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(() => mapBounded([1], 0, () => Promise.resolve(1))).toThrow(RangeError);
  });
});

function problem(detail: string, type = NOT_FOUND_TYPE): Response {
  return new Response(JSON.stringify({ type, title: "Not found", status: 404, detail }), {
    status: 404,
    headers: { "content-type": "application/problem+json" },
  });
}

function portAnswering(response: () => Response): SolverPort {
  const client = createSolverQuery("http://solver-query.fake:7070", { fetch: () => Promise.resolve(response()) });
  return solverPort(client, { id: "req-1" } as FastifyRequest);
}

describe("R3.6 a node read's 404 (PR #25 review MEDIUM 5, re-review LOW 3)", () => {
  const solution = "0190f000-0000-7000-8000-00000000501a";

  it("R3.6 a hand-not-in-range problem is no row: the hand ends there", async () => {
    const port = portAnswering(() => problem("any detail", HAND_OFF_RANGE_TYPE));
    await expect(port.nodeForHand(solution, "cfg_6_online_100/BB-BTN/", "AhKd")).resolves.toBeUndefined();
  });

  it("R3.6 a not-found problem (no such solution or node) is a 502, whatever its detail says", async () => {
    for (const detail of ["solution 0190f000 is not in the library", `hand "AKo" is not in the node's range`]) {
      const port = portAnswering(() => problem(detail));
      await expect(port.nodeForHand(solution, "cfg_6_online_100/BB-BTN/", "AhKd")).rejects.toMatchObject({ status: 502, slug: "upstream" });
    }
  });

  it("R3.6 only the problem type decides; the detail text is never parsed", () => {
    expect(isHandOffRange({ type: HAND_OFF_RANGE_TYPE, detail: "anything" })).toBe(true);
    expect(isHandOffRange({ type: NOT_FOUND_TYPE, detail: `hand "72o" is not in the node's range` })).toBe(false);
    expect(isHandOffRange({ type: "urn:g-tee-oh:problem:bad-request" })).toBe(false);
    expect(isHandOffRange("not json")).toBe(false);
  });
});

/** A fetch that never answers until its signal aborts, as a stalled solver-query would. */
const stalled: typeof fetch = (input, init) =>
  new Promise((_resolve, reject) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    signal?.addEventListener("abort", () => reject(new Error("aborted", { cause: signal.reason })), { once: true });
  });

describe("R3.6 the per-request deadline (PR #25 re-review BLOCKER 2)", () => {
  it("R3.6 a call past the deadline is a transient 503, and every later call of the request fails fast", async () => {
    const client = createSolverQuery("http://solver-query.fake:7070", { fetch: stalled });
    const port = solverPort(client, { id: "req-2" } as FastifyRequest, { deadlineMs: 20 });
    await expect(port.coverage("cfg_6_online_100", "BB-BTN")).rejects.toMatchObject({ status: 503, slug: "unavailable" });
    await expect(port.deal({ config_id: "cfg_6_online_100", pair: "BB-BTN" }, "0000000000000001")).rejects.toMatchObject({ status: 503 });
    expect(SESSION_DEADLINE_MS).toBeGreaterThan(0);
  });
});
