/**
 * A fake solver-query for the session and grading tests (R3.6, R3.7): an injected fetch answering
 * canned NodeResponse, DealResponse, SampleActionResponse, RevealResponse, GradeResponse and
 * CoverageResponse bodies shaped like packages/contracts/src/solver-query.generated.ts, over a
 * three-node heads-up tree, so the machine, derivation, persistence, transaction and idempotency
 * tests run against the test database without the fixture library. The replay golden
 * (sessions-replay.test.ts) runs against the real fixture solver-query instead.
 *
 * The tree (BTN is the hero at the root, BB the villain):
 * - root: BTN to act; fold, raise to 2.5bb, raise to 3bb (two raises, so Simple mode groups them);
 * - r250: BB to act; fold, call (closes preflop), raise to 10bb;
 * - r250.r1000: BTN to act; fold, call.
 * Numbers are test data, chosen so each grading branch is reachable; nothing here is poker math.
 */
import type { SolverQueryComponents } from "@g-tee-oh/contracts";

import { createSolverQuery, type SolverQuery } from "../src/solver-query/client.js";

type Schemas = SolverQueryComponents["schemas"];

export const FAKE_BASE = "http://solver-query.fake:7070";
export const FAKE_CONFIG = "cfg_6_online_100";
export const FAKE_PAIR = "BB-BTN";
export const ROOT_KEY = `${FAKE_CONFIG}/${FAKE_PAIR}/`;
export const OPEN_KEY = `${ROOT_KEY}r250`;
export const THREE_BET_KEY = `${ROOT_KEY}r250.r1000`;
export const HERO_HAND = "AhKd";
export const VILLAIN_HAND = "QsQc";
export const FLOP_BOARD = "3cKh4c";
export const FAKE_DEAL_ID = "0190f000-0000-7000-8000-00000000dea1";

interface FakeNode {
  toAct: "BTN" | "BB";
  pot: number;
  stacks: number[];
  spotClass: string | null;
  actions: Schemas["ActionView"][];
  freq: number[];
  ev: number[];
  loss: number[];
}

function action(index: number, token: string, kind: Schemas["ActionKind"], size: number, next: string | null, bucket: string | null = null): Schemas["ActionView"] {
  return { index, token, kind, size_cbb: size, bucket, label: token, next_node_key: next };
}

const TREE: Readonly<Record<string, FakeNode>> = {
  [ROOT_KEY]: {
    toAct: "BTN",
    pot: 150,
    stacks: [9900, 10000],
    spotClass: "preflop/online/100/rfi/BB-BTN",
    actions: [action(0, "f", "fold", 0, null), action(1, "r250", "raise", 250, OPEN_KEY, "overbet-large"), action(2, "r300", "raise", 300, OPEN_KEY, "overbet-large")],
    freq: [0.3, 0.7, 0],
    ev: [0, 0.6, 0.5],
    loss: [40, 0, 6.5],
  },
  [OPEN_KEY]: {
    toAct: "BB",
    pot: 400,
    stacks: [9900, 9750],
    spotClass: "preflop/online/100/facing-open/BB-BTN",
    actions: [action(0, "f", "fold", 0, null), action(1, "c", "call", 250, null), action(2, "r1000", "raise", 1000, THREE_BET_KEY, "overbet-large")],
    freq: [0.2, 0.5, 0.3],
    ev: [0, 0.2, 0.2],
    loss: [5, 0, 0],
  },
  [THREE_BET_KEY]: {
    toAct: "BTN",
    pot: 1300,
    stacks: [9000, 9750],
    spotClass: null,
    actions: [action(0, "f", "fold", 0, null), action(1, "c", "call", 1000, null)],
    freq: [0.5, 0.5],
    ev: [0, 0],
    loss: [0, 0],
  },
};

export interface FakeOptions {
  solutionId: string;
  /** "config/pair" entries the library covers; the fake pair by default. */
  covered?: readonly string[];
  /** The opponent's action index at a node; 1 (call) at r250 by default. */
  opponentChoice?: Readonly<Record<string, number>>;
  /** Nodes where the hero's hand has no row (a 404). */
  heroOffRange?: readonly string[];
}

export interface FakeCall {
  method: string;
  path: string;
  body: unknown;
}

export interface FakeSolverQuery {
  client: SolverQuery;
  calls: FakeCall[];
  count(path: string): number;
}

const NOT_FOUND = { type: "urn:g-tee-oh:problem:not-found", title: "Not found", status: 404, detail: "not here" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function nodeBody(solutionId: string, key: string, node: FakeNode): Schemas["NodeResponse"] {
  return {
    solution_id: solutionId,
    node_key: key,
    street: "preflop",
    config_id: FAKE_CONFIG,
    pair: FAKE_PAIR,
    to_act: node.toAct,
    pot_cbb: node.pot,
    stacks_cbb: node.stacks,
    hand_space: "preflop_169",
    accuracy_pct_pot: null,
    floor_pct_pot: 0.5,
    spot_class_key: node.spotClass,
    actions: node.actions,
    hands: [],
    range_summary: { oop: { combos: 1, reach_weighted_combos: 1 }, ip: { combos: 1, reach_weighted_combos: 1 }, by_action: [] },
    noise_flags: [],
    synthetic: true,
  };
}

function gradeBody(solutionId: string, request: Schemas["GradeRequest"], node: FakeNode): Schemas["GradeResponse"] {
  const index = request.action_index;
  const best = Math.max(...node.ev);
  return {
    solution_id: solutionId,
    node_key: request.node_key,
    hand: request.hand,
    action_index: index,
    reference: request.reference ?? null,
    ev_by_action: node.ev,
    freq_by_action: node.freq,
    best_action_index: node.ev.indexOf(best),
    ev_chosen_bb: node.ev[index] ?? 0,
    ev_best_bb: best,
    loss_bb: best - (node.ev[index] ?? 0),
    loss_pct_pot: node.loss[index] ?? 0,
    loss_pct_pot_by_action: node.loss,
    floor_pct_pot: 0.5,
    floor_source: "fallback_bb",
    bucket: node.actions[index]?.bucket ?? null,
    noise_flags: [],
    difficulty_features: { ev_gap_pct_pot: 0, purity: 1, n_actions: node.actions.length, mixed: false, all_within_floor: false },
  };
}

function nextState(state: string): string {
  return ((BigInt(`0x${state}`) + 1n) % (1n << 64n)).toString(16).padStart(16, "0");
}

type Route = (url: URL, body: Record<string, unknown>) => Response;

function routes(options: FakeOptions): Record<string, Route> {
  const covered = new Set(options.covered ?? [`${FAKE_CONFIG}/${FAKE_PAIR}`]);
  const offRange = new Set(options.heroOffRange ?? []);
  const choice: Readonly<Record<string, number>> = { [OPEN_KEY]: 1, ...options.opponentChoice };
  const { solutionId } = options;
  return {
    "GET /v1/coverage": (url) => {
      const key = `${url.searchParams.get("config_id")}/${url.searchParams.get("pair")}`;
      const available = covered.has(key);
      return json(200, {
        config_id: url.searchParams.get("config_id"),
        pair: url.searchParams.get("pair"),
        preflop: { available, solution_ids: available ? [solutionId] : [], sources: available ? ["fixture"] : [], synthetic: true },
        flops: [],
        textures: [],
        queue: [],
        database: "unconfigured",
      });
    },
    "POST /v1/deal": () =>
      json(200, {
        deal_id: FAKE_DEAL_ID,
        solution_ids: [solutionId],
        start_node_key: ROOT_KEY,
        hero_position: "BTN",
        villain_position: "BB",
        hero_hand: HERO_HAND,
        villain_hand: VILLAIN_HAND,
        revealed: { flop: null, turn: null, river: null },
      }),
    "GET /v1/nodes": (url) => {
      const key = url.searchParams.get("node_key") ?? "";
      const node = TREE[key];
      const heroMissing = url.searchParams.get("hands") === HERO_HAND && offRange.has(key);
      return node === undefined || heroMissing ? json(404, NOT_FOUND) : json(200, nodeBody(solutionId, key, node));
    },
    "POST /v1/sample-action": (_url, body) => {
      const key = String(body.node_key);
      const index = choice[key] ?? 0;
      const token = TREE[key]?.actions[index]?.token ?? "?";
      return json(200, { action_index: index, token, roll: 0.5, rng_state: nextState(String(body.rng_state)) });
    },
    "GET /v1/deal/reveal": (url) =>
      json(200, { deal_id: FAKE_DEAL_ID, street: url.searchParams.get("street"), cards: ["3c", "Kh", "4c"], board: FLOP_BOARD }),
    "POST /v1/grade": (_url, body) => {
      const request = body as unknown as Schemas["GradeRequest"];
      const node = TREE[request.node_key];
      return node === undefined ? json(404, NOT_FOUND) : json(200, gradeBody(solutionId, request, node));
    },
  };
}

function routeKey(method: string, path: string): string {
  return `${method} ${path.startsWith("/v1/deal/") && path.endsWith("/reveal") ? "/v1/deal/reveal" : path}`;
}

/** A solver-query client over the fake tree, recording every call. */
export function fakeSolverQuery(options: FakeOptions): FakeSolverQuery {
  const calls: FakeCall[] = [];
  const table = routes(options);
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text = request.method === "GET" ? "" : await request.text();
    const body = text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
    calls.push({ method: request.method, path: url.pathname, body });
    const route = table[routeKey(request.method, url.pathname)];
    return route === undefined ? json(404, NOT_FOUND) : route(url, body);
  };
  return {
    client: createSolverQuery(FAKE_BASE, { fetch: fetchImpl }),
    calls,
    count: (path) => calls.filter((call) => call.path === path || (path === "reveal" && call.path.endsWith("/reveal"))).length,
  };
}
