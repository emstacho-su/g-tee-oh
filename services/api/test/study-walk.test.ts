/**
 * Study tree walking and prefetch reads (R3.3, O-245): the root key vector pinned to Rust output,
 * the line split, the walk by next_node_key with its 404s, the next likely action, and the
 * read-through node reader with background prefetch.
 */
import { describe, expect, it, vi } from "vitest";

import { ProblemError } from "../src/http/problem.js";
import type { SqAction, SqNode } from "../src/solver-query/client.js";
import { appendToken, lineTokens, nextLikelyAction, rootNodeKey, walkLine } from "../src/study/line-walk.js";
import { createNodeCache } from "../src/study/node-cache.js";
import { createNodeReader, type NodeRequest } from "../src/study/node-reader.js";

const ROOT = "cfg_6_online_100/BB-BTN/";

function action(index: number, token: string, next: string | null): SqAction {
  return { index, token, kind: "raise", size_cbb: 250, bucket: null, label: token, next_node_key: next };
}

function node(key: string, actions: SqAction[], shares: number[] = actions.map(() => 1 / actions.length)): SqNode {
  return {
    solution_id: "s",
    node_key: key,
    config_id: "cfg_6_online_100",
    pair: "BB-BTN",
    street: "preflop",
    to_act: "BTN",
    pot_cbb: 150,
    stacks_cbb: [9900, 10000],
    hand_space: "preflop_169",
    floor_pct_pot: 1,
    actions,
    hands: [],
    noise_flags: [],
    range_summary: {
      oop: { combos: 1326, reach_weighted_combos: 1326 },
      ip: { combos: 1326, reach_weighted_combos: 1326 },
      by_action: shares.map((share, index) => ({ index, share, combos: 0 })),
    },
    synthetic: true,
  };
}

const TREE: Record<string, SqNode> = {
  [ROOT]: node(ROOT, [action(0, "f", null), action(1, "r250", `${ROOT}r250`)], [0.6, 0.4]),
  [`${ROOT}r250`]: node(`${ROOT}r250`, [action(0, "f", null), action(1, "c", null), action(2, "r900", `${ROOT}r250.r900`)]),
  [`${ROOT}r250.r900`]: node(`${ROOT}r250.r900`, [action(0, "f", null)]),
};

function readTree(key: string): Promise<SqNode> {
  const found = TREE[key];
  return found === undefined ? Promise.reject(new Error(`no ${key}`)) : Promise.resolve(found);
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

describe("R3.3 study line walk (O-245)", () => {
  it("R3.3 the root key matches gto-model's vector cfg_6_online_100/BB-BTN/ (keys_and_tokens.rs)", () => {
    expect(rootNodeKey("cfg_6_online_100", "BB-BTN")).toBe("cfg_6_online_100/BB-BTN/");
  });

  it("R3.3 splits a line into its dot-separated tokens and appends one", () => {
    expect(lineTokens(undefined)).toEqual([]);
    expect(lineTokens("r250.c")).toEqual(["r250", "c"]);
    expect(appendToken(undefined, "r250")).toBe("r250");
    expect(appendToken("r250", "c")).toBe("r250.c");
  });

  it("R3.3 walks from the root through next_node_key", async () => {
    expect((await walkLine(ROOT, [], readTree)).node_key).toBe(ROOT);
    expect((await walkLine(ROOT, ["r250", "r900"], readTree)).node_key).toBe(`${ROOT}r250.r900`);
  });

  it("R3.3 a token the node does not offer is a 404 problem", async () => {
    const problem = await problemOf(walkLine(ROOT, ["r300"], readTree));
    expect([problem.status, problem.slug]).toEqual([404, "not-found"]);
    expect(problem.detail).toContain("r300");
  });

  it("R3.3 a token that ends the solution mid-line is a 404 problem", async () => {
    const problem = await problemOf(walkLine(ROOT, ["r250", "c", "x"], readTree));
    expect([problem.status, problem.slug]).toEqual([404, "not-found"]);
    expect(problem.detail).toContain("c");
  });

  it("R3.3 the next likely action is the largest range share, lowest index on a tie", () => {
    expect(nextLikelyAction(TREE[ROOT] as SqNode)?.token).toBe("f");
    const tie = node(ROOT, [action(0, "f", null), action(1, "c", null)], [0.5, 0.5]);
    expect(nextLikelyAction(tie)?.token).toBe("f");
    const raise = node(ROOT, [action(0, "f", null), action(1, "r250", "k")], [0.2, 0.8]);
    expect(nextLikelyAction(raise)?.token).toBe("r250");
    expect(nextLikelyAction(node(ROOT, [], []))).toBeNull();
  });
});

describe("R3.3 study node reader (prefetch)", () => {
  const request: NodeRequest = { solutionId: "s", nodeKey: ROOT, hands: "class" };

  it("R3.3 reads through the cache: a second read of the same node fetches nothing", async () => {
    const fetchNode = vi.fn((r: NodeRequest) => readTree(r.nodeKey));
    const reader = createNodeReader(createNodeCache<SqNode>());
    await reader.read(request, fetchNode);
    const again = await reader.read(request, fetchNode);
    expect(again.node_key).toBe(ROOT);
    expect(fetchNode).toHaveBeenCalledTimes(1);
  });

  it("R3.3 a prefetched node is served without a fetch, and a read joins a prefetch in flight", async () => {
    const fetchNode = vi.fn((r: NodeRequest) => readTree(r.nodeKey));
    const reader = createNodeReader(createNodeCache<SqNode>());
    const warn = vi.fn();
    const prefetched = reader.prefetch(request, fetchNode, warn);
    const joined = await reader.read(request, fetchNode);
    await prefetched;
    await reader.read(request, fetchNode);
    expect(joined.node_key).toBe(ROOT);
    expect(fetchNode).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("R3.3 a prefetch failure is logged at warn, never thrown, and never cached", async () => {
    const failing = vi.fn(() => Promise.reject(new Error("upstream down")));
    const reader = createNodeReader(createNodeCache<SqNode>());
    const warn = vi.fn();
    await expect(reader.prefetch(request, failing, warn)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const fetchNode = vi.fn((r: NodeRequest) => readTree(r.nodeKey));
    expect((await reader.read(request, fetchNode)).node_key).toBe(ROOT);
    expect(fetchNode).toHaveBeenCalledTimes(1);
  });

  it("R3.3 a read that joined a failed prefetch reads again rather than surfacing the prefetch error", async () => {
    let rejectPrefetch: (error: Error) => void = () => undefined;
    const pending = new Promise<SqNode>((_resolve, reject) => {
      rejectPrefetch = reject;
    });
    const reader = createNodeReader(createNodeCache<SqNode>());
    const warn = vi.fn();
    const prefetched = reader.prefetch(request, () => pending, warn);
    const fetchNode = vi.fn((r: NodeRequest) => readTree(r.nodeKey));
    const read = reader.read(request, fetchNode);
    rejectPrefetch(new Error("upstream down"));
    expect((await read).node_key).toBe(ROOT);
    await prefetched;
    expect(fetchNode).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("R3.3 a read failure propagates and is not cached", async () => {
    const reader = createNodeReader(createNodeCache<SqNode>());
    await expect(reader.read(request, () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    const fetchNode = vi.fn((r: NodeRequest) => readTree(r.nodeKey));
    await reader.read(request, fetchNode);
    expect(fetchNode).toHaveBeenCalledTimes(1);
  });

  it("R3.3 a prefetch of a node already cached fetches nothing", async () => {
    const fetchNode = vi.fn((r: NodeRequest) => readTree(r.nodeKey));
    const reader = createNodeReader(createNodeCache<SqNode>());
    await reader.read(request, fetchNode);
    await reader.prefetch(request, fetchNode, vi.fn());
    expect(fetchNode).toHaveBeenCalledTimes(1);
  });
});
