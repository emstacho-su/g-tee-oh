// The measured flow of just perf (R3.3, O-40, O-248): log in, find the study nodes, start one
// drill session, then time the three paths.
//
// - study node read: the client round trip of GET /api/v1/study/node, cycling over the distinct
//   nodes of PERF_CONFIG_ID the api serves: every pair's root (the pairs come from the catalog)
//   and the nodes along its likeliest line, which the api names as next_likely_node_key and
//   prefetches (R3.3), so a read of one of those may be served from the prefetch cache, as in use.
// - grade: the sq-grade entry of the Server-Timing header of each decision response, the api's
//   own measurement of its solver-query grade call (solver-query publishes no port on the stack).
// - decision to feedback: the client round trip of POST /api/v1/sessions/{id}/decisions. The
//   GET /api/v1/sessions/{id}/next before it fetches the prompt and is not counted.
//
// The drill is fixed (PERF_DRILL) on the fixture configuration's BB-BTN pair with the after-action
// stop rule, so every decision is followed by a fresh prompt. The session takes a fixed seed
// (O-249), so two runs deal the same hands. Each decision answers the state_version the prompt
// carried and sends its own Idempotency-Key, so the timed path includes the idempotent write the
// api performs for a keyed decision (O-232).

import { randomUUID } from "node:crypto";

import { PerfError } from "./errors.mjs";
import { serverTimingDuration } from "./server-timing.mjs";

export const DEFAULT_COUNTS = { warmup: 20, samples: 200 };
export const PERF_CONFIG_ID = "cfg_6_online_100";
export const PERF_PAIR = "BB-BTN";
/** The fixed session seed, a Hex64 string (O-151). */
export const PERF_SESSION_SEED = "0000000000005eed";
/** The most distinct study nodes the reads cycle over. */
export const MAX_STUDY_TARGETS = 64;
/** The most next_likely_node_key steps followed below each pair's root during discovery. */
export const MAX_WALK_DEPTH = 4;
/** The reaction time each decision reports; the api records it, the timing ignores it. */
export const DECISION_RESPONSE_MS = 1000;
const PAIRS_PAGE_LIMIT = 50;
const HERO_TURN = "await_hero";
const API = "/api/v1";
const HTTP = { ok: 200, created: 201 };
const BODY_EXCERPT_LENGTH = 200;

export const PERF_DRILL = {
  name: "perf: BTN versus BB preflop",
  tags: ["perf"],
  spot_filter: {
    game_config: { format: "online", table_size: 6, depths_bb: [100] },
    stake: "online",
    sizing: { mode: "convention" },
    start_street: "preflop",
    hero_positions: ["BTN"],
    villain_positions: ["BB"],
    preflop_action: ["rfi"],
    hands: { mode: "all" },
    alternate_seats: false,
  },
  trainer: {
    stop_rule: "after_action",
    input: "actions",
    grouping: "standard",
    rng: false,
    pause: "never",
    speed: "fast",
    quick_result: true,
    tables: 1,
    timebank_s: null,
    panels: {},
  },
};

function parseBody(response, what) {
  try {
    return JSON.parse(response.body);
  } catch {
    throw new PerfError(`${what} answered a body that is not JSON`);
  }
}

/** The JSON body of `response` when its status is `expected`; otherwise a PerfError with the status. */
function expectJson(response, expected, what) {
  if (response.status !== expected) {
    const excerpt = String(response.body ?? "").slice(0, BODY_EXCERPT_LENGTH);
    throw new PerfError(`${what} answered ${response.status}, expected ${expected}: ${excerpt}`);
  }
  return parseBody(response, what);
}

function requireString(value, what) {
  if (typeof value !== "string" || value === "") throw new PerfError(`${what} is missing from the response`);
  return value;
}

async function login(client, owner) {
  const response = await client.request("POST", `${API}/auth/login`, { body: { email: owner.email, password: owner.password } });
  const session = expectJson(response, HTTP.ok, "POST /auth/login");
  client.setCsrfToken(requireString(session.csrf_token, "csrf_token"));
}

async function listPairs(client, configId) {
  const pairs = [];
  let cursor = null;
  do {
    const query = new URLSearchParams({ limit: String(PAIRS_PAGE_LIMIT), ...(cursor === null ? {} : { cursor }) });
    const page = expectJson(await client.request("GET", `${API}/configs/${configId}/pairs?${query}`), HTTP.ok, "GET /configs/{id}/pairs");
    pairs.push(...page.items.map((item) => requireString(item.pair, "pair")));
    cursor = page.next_cursor ?? null;
  } while (cursor !== null);
  return pairs;
}

function studyPath(query) {
  return `${API}/study/node?${new URLSearchParams(query)}`;
}

/**
 * The nodes of one pair along its likeliest line: the root, then each next_likely_node_key the
 * api names (O-245), read back through node_key, at most MAX_WALK_DEPTH steps below the root. An
 * uncovered pair (the root is not served) yields none.
 */
async function walkPair(client, configId, pair) {
  const found = [];
  let query = { config_id: configId, pair };
  for (let depth = 0; depth <= MAX_WALK_DEPTH && query !== null; depth += 1) {
    const response = await client.request("GET", studyPath(query));
    if (response.status !== HTTP.ok) break;
    found.push(query);
    const next = parseBody(response, "GET /study/node").next_likely_node_key;
    query = typeof next === "string" && next !== "" ? { config_id: configId, pair, node_key: next } : null;
  }
  return found;
}

/** Every distinct node the api serves for `configId`, as study queries, at most MAX_STUDY_TARGETS. */
export async function discoverStudyTargets(client, configId) {
  const targets = [];
  for (const pair of await listPairs(client, configId)) {
    targets.push(...(await walkPair(client, configId, pair)));
  }
  if (targets.length === 0) {
    throw new PerfError(`GET /study/node served no node of ${configId}; is the fixture library mounted (FIXTURE_LIBRARY_PATH)?`);
  }
  return targets.slice(0, MAX_STUDY_TARGETS);
}

async function measureStudy(client, targets, counts) {
  const timed = [];
  for (let index = 0; index < counts.warmup + counts.samples; index += 1) {
    const response = await client.request("GET", studyPath(targets[index % targets.length]));
    expectJson(response, HTTP.ok, "GET /study/node");
    if (index >= counts.warmup) timed.push(response.ms);
  }
  return timed;
}

async function startSession(client) {
  const drill = expectJson(await client.request("POST", `${API}/drills`, { body: PERF_DRILL }), HTTP.created, "POST /drills");
  const body = { mode: "drill", drill_id: requireString(drill.id, "drill id"), seed: PERF_SESSION_SEED };
  const session = expectJson(await client.request("POST", `${API}/sessions`, { body }), HTTP.created, "POST /sessions");
  return requireString(session.session_id, "session_id");
}

async function nextPrompt(client, sessionId) {
  const prompt = expectJson(await client.request("GET", `${API}/sessions/${sessionId}/next`), HTTP.ok, "GET /sessions/{id}/next");
  if (prompt.state !== HERO_TURN || !Array.isArray(prompt.buttons) || prompt.buttons.length === 0) {
    throw new PerfError(`GET /sessions/{id}/next should prompt ${HERO_TURN} with buttons, got state ${String(prompt.state)}`);
  }
  return prompt;
}

async function decide(client, sessionId, prompt, index) {
  const button = prompt.buttons[index % prompt.buttons.length];
  const body = { state_version: prompt.state_version, action_index: button.index, response_ms: DECISION_RESPONSE_MS };
  const response = await client.request("POST", `${API}/sessions/${sessionId}/decisions`, { body, idempotencyKey: randomUUID() });
  expectJson(response, HTTP.ok, "POST /sessions/{id}/decisions");
  return { decisionMs: response.ms, gradeMs: serverTimingDuration(response.headers["server-timing"], "sq-grade") };
}

async function measureDecisions(client, sessionId, counts) {
  const grade = [];
  const decisionFeedback = [];
  for (let index = 0; index < counts.warmup + counts.samples; index += 1) {
    const sample = await decide(client, sessionId, await nextPrompt(client, sessionId), index);
    if (index >= counts.warmup) {
      grade.push(sample.gradeMs);
      decisionFeedback.push(sample.decisionMs);
    }
  }
  return { grade, decisionFeedback };
}

/** The whole measured run: { timings: { path id: ms[] }, run: the report's run fields }. */
export async function runPerf(client, { owner, counts = DEFAULT_COUNTS, baseUrl = "https://localhost" }) {
  await login(client, owner);
  const targets = await discoverStudyTargets(client, PERF_CONFIG_ID);
  const study = await measureStudy(client, targets, counts);
  const sessionId = await startSession(client);
  const { grade, decisionFeedback } = await measureDecisions(client, sessionId, counts);
  return {
    timings: { "study-node": study, grade, "decision-feedback": decisionFeedback },
    run: {
      base_url: baseUrl,
      config_id: PERF_CONFIG_ID,
      pair: PERF_PAIR,
      warmup_per_path: counts.warmup,
      samples_per_path: counts.samples,
      study_targets: targets.length,
    },
  };
}
