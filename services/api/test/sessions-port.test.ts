/**
 * The session's solver-query port and its fan-out (R3.6, ADR 0018, PR #25 review MEDIUM 3 and 5):
 * coverage reads run at most MAX_CONCURRENT_SOLVER_CALLS at a time, and a node read's 404 ends the
 * hand only when solver-query says the hand is outside the node's range; a solution or node the
 * library no longer holds is a 502, never silent play.
 */
import { describe, expect, it } from "vitest";

import { splitByCoverage } from "../src/sessions/candidates.js";
import { mapBounded, MAX_CONCURRENT_SOLVER_CALLS } from "../src/sessions/concurrency.js";
import { isHandOffRange, solverPort, type SolverPort } from "../src/sessions/solver-port.js";
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

describe("R3.6 a node read's 404 (PR #25 review MEDIUM 5)", () => {
  const solution = "0190f000-0000-7000-8000-00000000501a";

  it("R3.6 a hand outside the node's range is no row: the hand ends there", async () => {
    const port = portAnswering(() => problem(`hand "AKo" is not in the node's range`));
    await expect(port.nodeForHand(solution, "cfg_6_online_100/BB-BTN/", "AhKd")).resolves.toBeUndefined();
  });

  it("R3.6 a solution or node the library does not hold is a 502, not an off-range hand", async () => {
    for (const detail of ["solution 0190f000 is not in the library", `node "cfg_6_online_100/BB-BTN/r9" is not in this solution`]) {
      const port = portAnswering(() => problem(detail));
      await expect(port.nodeForHand(solution, "cfg_6_online_100/BB-BTN/", "AhKd")).rejects.toMatchObject({ status: 502, slug: "upstream" });
    }
  });

  it("R3.6 the problem body decides: a distinct slug is honoured, another slug or a non-problem body is not off range", () => {
    expect(isHandOffRange({ type: NOT_FOUND_TYPE, detail: `hand "72o" is not in the node's range` })).toBe(true);
    expect(isHandOffRange({ type: "urn:g-tee-oh:problem:hand-not-in-range", detail: "anything" })).toBe(true);
    expect(isHandOffRange({ type: "urn:g-tee-oh:problem:bad-request", detail: `hand "72o" is not in the node's range` })).toBe(false);
    expect(isHandOffRange("not json")).toBe(false);
  });
});
