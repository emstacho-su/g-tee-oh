/**
 * A fake solver-query for the session and grading tests (R3.6, R3.7): an injected fetch answering
 * canned NodeResponse, DealResponse, SampleActionResponse, RevealResponse, GradeResponse and
 * CoverageResponse bodies shaped like packages/contracts/src/solver-query.generated.ts, over a
 * three-node heads-up tree, so the machine, derivation, persistence, transaction and idempotency
 * tests run against the test database without the fixture library. The replay golden
 * (sessions-replay.test.ts) runs against the real fixture solver-query instead.
 *
 * The tree (BTN acts first at the root, BB second):
 * - root: BTN to act; fold, raise to 2.5bb, raise to 3bb (two raises, so Simple mode groups them);
 * - r250: BB to act; fold, call (closes preflop), raise to 10bb;
 * - r250.r1000: BTN to act; fold, call.
 * Each node carries the action family solver-query's classify gives its line (rfi, facing-open,
 * facing-3bet). The deal starts at the filter's line (the root without one), with the seat to act
 * there as hero_position, and picks its cards from `deals` by the seed (seed modulo the list
 * length), so a hands-filter test can be dealt hands that fail the filter first. Hand rows come
 * back labelled with the class solver-query writes in the preflop_169 space; every class plays
 * the node's strategy except 72o, which folds purely (never a close decision). A 404 carries the
 * problem type solver-query writes for its cause: hand-not-in-range for a hand outside the node's
 * range, not-found for a node the solution does not hold.
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
/** A hand whose row folds purely, so a close-decisions filter never keeps it. */
export const PURE_FOLD_HAND = "7c2d";
export const FLOP_BOARD = "3cKh4c";
export const FAKE_DEAL_ID = "0190f000-0000-7000-8000-00000000dea1";

/** The class label of each fake combo's row (preflop_169 space). */
const DEAL_CLASSES: Readonly<Record<string, string>> = { [HERO_HAND]: "AKo", [VILLAIN_HAND]: "QQ", [PURE_FOLD_HAND]: "72o" };
const PURE_FOLD_CLASS = "72o";
const PURE_FOLD_LOSS = 50;

interface FakeNode {
  toAct: "BTN" | "BB";
  family: string;
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
    family: "rfi",
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
    family: "facing-open",
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
    family: "facing-3bet",
    pot: 1300,
    stacks: [9000, 9750],
    spotClass: null,
    actions: [action(0, "f", "fold", 0, null), action(1, "c", "call", 1000, null)],
    freq: [0.5, 0.5],
    ev: [0, 0],
    loss: [0, 0],
  },
};

export interface FakeDeal {
  btn: string;
  bb: string;
}

export interface FakeOptions {
  solutionId: string;
  /** "config/pair" entries the library covers; the fake pair by default. */
  covered?: readonly string[];
  /** The opponent's action index at a node; 1 (call) at r250 by default. */
  opponentChoice?: Readonly<Record<string, number>>;
  /** Nodes where the hero's hand (AhKd) has no row: a 404 "hand ... is not in the node's range". */
  heroOffRange?: readonly string[];
  /** Nodes the solution does not hold: a 404 not-found on every read. */
  missingNodes?: readonly string[];
  /** Nodes lost after POST /sessions: a 404 not-found on reads for one hand only. */
  lostNodes?: readonly string[];
  /** How many reads for one hand stall until the caller's deadline aborts them. */
  stallHandReads?: number;
  /** The deals POST /v1/deal answers, picked by the seed modulo the list length. */
  deals?: readonly FakeDeal[];
  /** Milliseconds every coverage answer waits, so a test can watch calls overlap. */
  coverageDelayMs?: number;
  /** The noise flags every /v1/grade answer carries; none by default (S27 R3.18). */
  gradeNoiseFlags?: readonly Schemas["NoiseFlag"][];
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
  /** The most coverage calls that were in flight at once. */
  maxCoverageInFlight(): number;
}

function notFound(detail: string): Record<string, unknown> {
  return { type: "urn:g-tee-oh:problem:not-found", title: "Not found", status: 404, detail };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function handRow(label: string, node: FakeNode): Schemas["HandRow"] {
  const pure = label === PURE_FOLD_CLASS;
  const strategy = pure ? node.actions.map((_, index) => (index === 0 ? 1 : 0)) : node.freq;
  const loss = pure ? node.actions.map((_, index) => (index === 0 ? 0 : PURE_FOLD_LOSS)) : node.loss;
  // mixed mirrors solver-query's rule (two or more actions at 0.05 or more, O-301) for the fake's fixed rows.
  return { hand: label, strategy, loss_pct_pot: loss, ev_bb: node.ev, ev_best_bb: Math.max(...node.ev), mixed: strategy.filter((f) => f >= 0.05).length >= 2 };
}

function nodeBody(solutionId: string, key: string, node: FakeNode, hand: string | null): Schemas["NodeResponse"] {
  const labels = hand === null ? Object.values(DEAL_CLASSES) : [DEAL_CLASSES[hand] ?? hand];
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
    action_family: node.family,
    actions: node.actions,
    hands: labels.map((label) => handRow(label, node)),
    range_summary: { oop: { combos: 1, reach_weighted_combos: 1 }, ip: { combos: 1, reach_weighted_combos: 1 }, by_action: [] },
    noise_flags: [],
    synthetic: true,
  };
}

function gradeBody(
  solutionId: string,
  request: Schemas["GradeRequest"],
  node: FakeNode,
  noiseFlags: readonly Schemas["NoiseFlag"][] = [],
): Schemas["GradeResponse"] {
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
    noise_flags: [...noiseFlags],
    difficulty_features: { ev_gap_pct_pot: 0, purity: 1, n_actions: node.actions.length, mixed: false, all_within_floor: false },
  };
}

function nextState(state: string): string {
  return ((BigInt(`0x${state}`) + 1n) % (1n << 64n)).toString(16).padStart(16, "0");
}

type Route = (url: URL, body: Record<string, unknown>, signal: AbortSignal) => Response | Promise<Response>;

interface InFlight {
  now: number;
  max: number;
}

function coverageRoute(options: FakeOptions, inFlight: InFlight): Route {
  const covered = new Set(options.covered ?? [`${FAKE_CONFIG}/${FAKE_PAIR}`]);
  return async (url) => {
    inFlight.now += 1;
    inFlight.max = Math.max(inFlight.max, inFlight.now);
    await new Promise((resolve) => setTimeout(resolve, options.coverageDelayMs ?? 0));
    inFlight.now -= 1;
    const key = `${url.searchParams.get("config_id")}/${url.searchParams.get("pair")}`;
    const available = covered.has(key);
    return json(200, {
      config_id: url.searchParams.get("config_id"),
      pair: url.searchParams.get("pair"),
      preflop: { available, solution_ids: available ? [options.solutionId] : [], sources: available ? ["fixture"] : [], synthetic: true },
      flops: [],
      textures: [],
      queue: [],
      database: "unconfigured",
    });
  };
}

function dealRoute(options: FakeOptions): Route {
  const deals = options.deals ?? [{ btn: HERO_HAND, bb: VILLAIN_HAND }];
  return (_url, body) => {
    const deal = deals[Number(BigInt(`0x${String(body.seed)}`) % BigInt(deals.length))] ?? deals[0];
    const line = (body.filter as { line?: string } | undefined)?.line;
    const start = line === undefined ? ROOT_KEY : `${ROOT_KEY}${line}`;
    const btnActs = TREE[start]?.toAct !== "BB";
    return json(200, {
      deal_id: FAKE_DEAL_ID,
      solution_ids: [options.solutionId],
      start_node_key: start,
      hero_position: btnActs ? "BTN" : "BB",
      villain_position: btnActs ? "BB" : "BTN",
      hero_hand: btnActs ? deal?.btn : deal?.bb,
      villain_hand: btnActs ? deal?.bb : deal?.btn,
      revealed: { flop: null, turn: null, river: null },
    });
  };
}

/** A response that never comes until the request's signal aborts, as a stalled solver-query would. */
function stalled(signal: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted by the caller's deadline", { cause: signal.reason })), { once: true });
  });
}

function nodesRoute(options: FakeOptions): Route {
  const offRange = new Set(options.heroOffRange ?? []);
  const missing = new Set(options.missingNodes ?? []);
  const lost = new Set(options.lostNodes ?? []);
  let stalls = options.stallHandReads ?? 0;
  return (url, _body, signal) => {
    const key = url.searchParams.get("node_key") ?? "";
    const node = TREE[key];
    const hand = url.searchParams.get("hands");
    if (hand !== null && stalls > 0) {
      stalls -= 1;
      return stalled(signal);
    }
    if (node === undefined || missing.has(key) || (hand !== null && lost.has(key))) {
      return json(404, notFound(`node ${JSON.stringify(key)} is not in this solution`));
    }
    if (hand === HERO_HAND && offRange.has(key)) {
      return json(404, { type: "urn:g-tee-oh:problem:hand-not-in-range", title: "Hand not in range", status: 404, detail: "x" });
    }
    return json(200, nodeBody(options.solutionId, key, node, hand));
  };
}

function routes(options: FakeOptions, inFlight: InFlight): Record<string, Route> {
  const choice: Readonly<Record<string, number>> = { [OPEN_KEY]: 1, ...options.opponentChoice };
  return {
    "GET /v1/coverage": coverageRoute(options, inFlight),
    "POST /v1/deal": dealRoute(options),
    "GET /v1/nodes": nodesRoute(options),
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
      return node === undefined ? json(404, notFound("no such node")) : json(200, gradeBody(options.solutionId, request, node, options.gradeNoiseFlags));
    },
  };
}

function routeKey(method: string, path: string): string {
  return `${method} ${path.startsWith("/v1/deal/") && path.endsWith("/reveal") ? "/v1/deal/reveal" : path}`;
}

/** A solver-query client over the fake tree, recording every call. */
export function fakeSolverQuery(options: FakeOptions): FakeSolverQuery {
  const calls: FakeCall[] = [];
  const inFlight: InFlight = { now: 0, max: 0 };
  const table = routes(options, inFlight);
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text = request.method === "GET" ? "" : await request.text();
    const body = text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
    calls.push({ method: request.method, path: url.pathname, body });
    const route = table[routeKey(request.method, url.pathname)];
    const signal = init?.signal ?? request.signal;
    return route === undefined ? json(404, notFound("no such route")) : route(url, body, signal);
  };
  return {
    client: createSolverQuery(FAKE_BASE, { fetch: fetchImpl }),
    calls,
    count: (path) => calls.filter((call) => call.path === path || (path === "reveal" && call.path.endsWith("/reveal"))).length,
    maxCoverageInFlight: () => inFlight.max,
  };
}
