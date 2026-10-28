/**
 * The problem types the session port relies on, against the real fixture solver-query binary
 * (R3.6, O-53, PR #25 re-review LOW 3): a hand outside a node's range answers a 404 whose type ends
 * in hand-not-in-range, which the port reads as "no row, the hand ends here", and a node the
 * solution does not hold answers not-found, which the port turns into a 502. If solver-query
 * renamed either type, the port would misread it; this test fails first. Needs the fixture library.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { HAND_OFF_RANGE_TYPE, isHandOffRange } from "../src/sessions/solver-port.js";
import { fixtureSolverQueryUrl } from "./support/solver-query.js";

const CONFIG = "cfg_6_online_100";
const PAIR = "BB-BTN";
const ROOT = `${CONFIG}/${PAIR}/`;
const RANKS = "AKQJT98765432";
const NOT_FOUND_TYPE = "urn:g-tee-oh:problem:not-found";
/** Nodes the search reads before giving up; the fixture's trees hold a handful. */
const MAX_NODES = 64;

const problemSchema = z.object({ type: z.string(), status: z.number() });
const coverageSchema = z.object({ preflop: z.object({ solution_ids: z.array(z.string()).min(1) }) });
const nodeSchema = z.object({
  hands: z.array(z.object({ hand: z.string() })),
  actions: z.array(z.object({ next_node_key: z.string().nullable().optional() })),
});

function allClasses(): string[] {
  return [...RANKS].flatMap((high, i) =>
    [...RANKS].slice(i).flatMap((low) => (high === low ? [`${high}${low}`] : [`${high}${low}s`, `${high}${low}o`])),
  );
}

async function getJson(path: string, query: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const url = new URL(path, fixtureSolverQueryUrl());
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url);
  return { status: response.status, body: await response.json() };
}

/** A node of the pair's tree and a class with no row there, found breadth first. */
async function offRangeHand(solutionId: string): Promise<{ key: string; hand: string }> {
  const classes = allClasses();
  const queue = [ROOT];
  for (let read = 0; read < MAX_NODES && queue.length > 0; read += 1) {
    const key = queue.shift() ?? ROOT;
    const node = nodeSchema.parse((await getJson("/v1/nodes", { solution_id: solutionId, node_key: key })).body);
    const held = new Set(node.hands.map((row) => row.hand));
    const missing = classes.find((hand) => !held.has(hand));
    if (missing !== undefined) {
      return { key, hand: missing };
    }
    for (const action of node.actions) {
      if (typeof action.next_node_key === "string") {
        queue.push(action.next_node_key);
      }
    }
  }
  throw new Error("no node of the fixture tree leaves a hand out of its range");
}

describe("R3.6 solver-query's 404 problem types (fixture library)", () => {
  it("R3.6 an off-range hand answers hand-not-in-range, and a missing node answers not-found", async () => {
    const coverage = coverageSchema.parse((await getJson("/v1/coverage", { config_id: CONFIG, pair: PAIR })).body);
    const solutionId = coverage.preflop.solution_ids[0] ?? "";
    const { key, hand } = await offRangeHand(solutionId);
    const offRange = await getJson("/v1/nodes", { solution_id: solutionId, node_key: key, hands: hand });
    expect(offRange.status).toBe(404);
    expect(problemSchema.parse(offRange.body).type).toBe(HAND_OFF_RANGE_TYPE);
    expect(isHandOffRange(offRange.body)).toBe(true);
    const missing = await getJson("/v1/nodes", { solution_id: solutionId, node_key: `${ROOT}r99999` });
    expect(missing.status).toBe(404);
    expect(problemSchema.parse(missing.body).type).toBe(NOT_FOUND_TYPE);
    expect(isHandOffRange(missing.body)).toBe(false);
  });
});
