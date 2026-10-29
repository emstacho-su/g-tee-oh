// Click to drill (S32, R4.12, O-321): the spot filter built from a heat map cell's coordinates,
// the reserved tag and idempotency key from sha256(spot_class_key), and the find, create, no
// match and failure paths of openClassDrill over a fake fetch.
import { describe, expect, it, vi } from "vitest";

import { ApiProblem, createAppApi } from "../../src/api/index.js";
import { fixtureSession } from "../../src/fixtures/index.js";
import { fixtureDrill } from "../../src/fixtures/trainer.js";
import { fixtureConfigs } from "../../src/fixtures/study.js";
import { DEFAULT_TRAINER } from "../../src/drills/draft.js";
import {
  depthBandOf,
  leakDrillBody,
  leakDrillName,
  matchingConfigs,
  pairSeats,
  spotFilterFor,
  type DrillSpot,
} from "../../src/progress/drill-family.js";
import {
  AUTO_TAG_HASH_CHARS,
  canonicalJson,
  autoDrillIdempotencyKey,
  autoDrillTag,
  drillTargetOf,
  NETWORK_FAILED_TEXT,
  openClassDrill,
  openFailureText,
  sha256Hex,
  unopenedText,
  type DrillTarget,
} from "../../src/progress/open-drill.js";
import type { GameConfig } from "../../src/progress/types.js";
import { createFakeFetch, jsonResponse, networkFailure, problemResponse, sessionResponse, type FetchScript } from "../api/fake-fetch.js";

const TEST_ORIGIN = "http://localhost:4173";
const SHA256_OF_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const LIVE_100: DrillSpot = { family: "rfi", pair: "BB-UTG", format: "live", depthBand: "100" };
const ONLINE_100: DrillSpot = { family: "facing-open", pair: "BB-BTN", format: "online", depthBand: "100" };

function config(overrides: Partial<GameConfig>): GameConfig {
  return { ...(fixtureConfigs[0] as GameConfig), ...overrides };
}

describe("R4.12 drill spot filter from a cell's coordinates (O-321)", () => {
  it("R4.12 depth bands follow gto-model's edges, lower edge inclusive", () => {
    expect([4_999, 5_000, 12_499, 12_500, 17_499, 17_500, 24_999, 25_000].map(depthBandOf)).toEqual([
      "short",
      "100",
      "100",
      "150",
      "150",
      "200",
      "200",
      "deep",
    ]);
  });

  it("R4.12 a pair is two different known seats, out of position first", () => {
    expect(pairSeats("BB-BTN")).toEqual(["BB", "BTN"]);
    expect(pairSeats("BB")).toBeNull();
    expect(pairSeats("BB-BB")).toBeNull();
    expect(pairSeats("XX-BB")).toBeNull();
    expect(pairSeats("SB-BB-BTN")).toBeNull();
  });

  it("R4.12 a live 100 bb rfi class drills at the live 9-handed 1/3 config with both seats as hero", () => {
    expect(spotFilterFor(LIVE_100, fixtureConfigs)).toEqual({
      game_config: { format: "live", table_size: 9, depths_bb: [100] },
      stake: "1/3",
      sizing: { mode: "convention" },
      start_street: "preflop",
      hero_positions: ["BB", "UTG"],
      villain_positions: [],
      preflop_action: ["rfi"],
      hands: { mode: "all" },
      alternate_seats: false,
    });
  });

  it("R4.12 the family picks its drill family and the band picks the config's depth", () => {
    const filter = spotFilterFor(ONLINE_100, fixtureConfigs);
    expect(filter?.preflop_action).toEqual(["vs_open"]);
    expect(filter?.game_config).toEqual({ format: "online", table_size: 6, depths_bb: [100] });
    expect(filter?.stake).toBe("online");
    expect(spotFilterFor({ ...ONLINE_100, depthBand: "200" }, fixtureConfigs)?.game_config.depths_bb).toEqual([200]);
    expect(spotFilterFor({ ...ONLINE_100, family: "blind-vs-blind", pair: "SB-BB" }, fixtureConfigs)?.preflop_action).toEqual(["rfi"]);
  });

  it("R4.12 no config, an unseated pair, an unknown family or pair gives no filter", () => {
    expect(spotFilterFor({ ...ONLINE_100, depthBand: "150" }, fixtureConfigs)).toBeNull();
    expect(spotFilterFor({ ...ONLINE_100, pair: "UTG1-BTN" }, fixtureConfigs)).toBeNull();
    expect(spotFilterFor({ ...ONLINE_100, family: "postflop" }, fixtureConfigs)).toBeNull();
    expect(spotFilterFor({ ...ONLINE_100, pair: "BTN" }, fixtureConfigs)).toBeNull();
    expect(matchingConfigs({ ...ONLINE_100, pair: "BTN" }, fixtureConfigs)).toEqual([]);
  });

  it("R4.12 the first match fixes table size and stake; every match of those adds its depth", () => {
    const configs = [
      config({ config_id: "cfg_9_online_105", table_size: 9, depth_cbb: 10_500 }),
      config({ config_id: "cfg_6_online_100", table_size: 6, depth_cbb: 10_000 }),
      config({ config_id: "cfg_9_online_110", table_size: 9, depth_cbb: 11_000 }),
      config({ config_id: "cfg_9_online_105b", table_size: 9, depth_cbb: 10_500 }),
    ];
    expect(spotFilterFor(ONLINE_100, configs)?.game_config).toEqual({ format: "online", table_size: 9, depths_bb: [105, 110] });
  });

  it("R4.12 names the drill from the coordinates and uses the builder's default trainer settings", () => {
    expect(leakDrillName(ONLINE_100)).toBe("Leak drill: facing an open, big blind versus button, online 100bb");
    const body = leakDrillBody(ONLINE_100, "auto-x", fixtureConfigs);
    expect(body?.trainer).toEqual(DEFAULT_TRAINER);
    expect(body?.tags).toEqual(["auto-x"]);
    expect(leakDrillBody({ ...ONLINE_100, depthBand: "150" }, "auto-x", fixtureConfigs)).toBeNull();
  });
});

describe("R4.12 the reserved tag and key (PM note 2)", () => {
  it("R4.12 hashes with sha256 and keeps the tag inside the api's tag pattern", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(SHA256_OF_ABC);
    const tag = autoDrillTag(SHA256_OF_ABC);
    expect(tag).toBe(`auto-${SHA256_OF_ABC.slice(0, AUTO_TAG_HASH_CHARS)}`);
    expect(tag).toMatch(TAG_PATTERN);
    expect(autoDrillIdempotencyKey(SHA256_OF_ABC, "b0d7")).toBe(`auto-drill-${SHA256_OF_ABC}-b0d7`);
  });

  it("R4.12 the canonical body text sorts object keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"e":0,"f":1}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("R4.12 a cell's target carries its key and its row and column coordinates", () => {
    const target = drillTargetOf(
      { spot_class_key: "k", row: 0, column: 0, p_known: null, mastered: false, retrievability: null, n: 0 },
      { family: "rfi", pair: "BB-UTG" },
      { format: "live", depth_band: "100" },
    );
    expect(target).toEqual({ spotClassKey: "k", spot: LIVE_100 });
  });
});

interface Recorded {
  url: string;
  idempotencyKey: string | null;
}

function harness(script: FetchScript, configs: readonly GameConfig[] = fixtureConfigs) {
  const fake = createFakeFetch({ "GET /api/v1/me": [sessionResponse()], ...script });
  const recorded: Recorded[] = [];
  const fetch = (input: Request): Promise<Response> => {
    recorded.push({ url: input.url, idempotencyKey: input.headers.get("idempotency-key") });
    return fake.fetch(input);
  };
  const loadConfigs = vi.fn(() => Promise.resolve(configs));
  const freshKeySuffix = vi.fn(() => FRESH_SUFFIX);
  return { fake, recorded, loadConfigs, deps: { api: createAppApi({ baseUrl: TEST_ORIGIN, fetch }), loadConfigs, freshKeySuffix } };
}

const TARGET: DrillTarget = { spotClassKey: "abc", spot: LIVE_100 };
const TAG = autoDrillTag(SHA256_OF_ABC);
const CREATED_ID = "00000000-0000-4000-8000-0000000000aa";
const RETRIED_ID = "00000000-0000-4000-8000-0000000000bb";
const FRESH_SUFFIX = "fresh-1";
const NO_DRILLS = jsonResponse(200, { items: [], next_cursor: null });

function postKeys(recorded: readonly Recorded[]): (string | null)[] {
  return recorded.filter((call) => new URL(call.url).pathname === "/api/v1/drills" && call.idempotencyKey !== null).map((call) => call.idempotencyKey);
}

async function bodyHashOf(postBody: string | undefined): Promise<string> {
  return sha256Hex(canonicalJson(JSON.parse(postBody ?? "{}") as unknown));
}

describe("R4.12 openClassDrill", () => {
  it("R4.12 reuses the drill the tag finds and creates nothing", async () => {
    const { fake, recorded, loadConfigs, deps } = harness({ "GET /api/v1/drills": [jsonResponse(200, { items: [fixtureDrill], next_cursor: null })] });
    await expect(openClassDrill(deps, TARGET)).resolves.toEqual({ kind: "opened", drillId: fixtureDrill.id, created: false });
    expect(new URL(recorded[0]?.url ?? "").searchParams.get("tag")).toBe(TAG);
    expect(fake.keys()).toEqual(["GET /api/v1/drills"]);
    expect(loadConfigs).not.toHaveBeenCalled();
  });

  it("R4.12 creates the drill under a key of the class hash and the body hash, then reads it back", async () => {
    const { fake, recorded, loadConfigs, deps } = harness({
      "GET /api/v1/drills": [NO_DRILLS],
      "POST /api/v1/drills": [jsonResponse(201, { ...fixtureDrill, id: CREATED_ID })],
      [`GET /api/v1/drills/${CREATED_ID}`]: [jsonResponse(200, { ...fixtureDrill, id: CREATED_ID })],
    });
    await expect(openClassDrill(deps, TARGET)).resolves.toEqual({ kind: "opened", drillId: CREATED_ID, created: true });
    expect(loadConfigs).toHaveBeenCalledWith("live");
    const post = fake.calls.find((call) => call.method === "POST");
    expect(post?.csrf).toBe(fixtureSession.csrf_token);
    expect(postKeys(recorded)).toEqual([`auto-drill-${SHA256_OF_ABC}-${await bodyHashOf(post?.body)}`]);
    expect(fake.keys()).toContain(`GET /api/v1/drills/${CREATED_ID}`);
    expect(deps.freshKeySuffix).not.toHaveBeenCalled();
    const body = JSON.parse(post?.body ?? "{}") as { name: string; tags: string[]; spot_filter: { stake: string }; trainer: unknown };
    expect(body.name).toBe("Leak drill: open or fold, big blind versus under the gun, live 100bb");
    expect(body.tags).toEqual([TAG]);
    expect(body.spot_filter.stake).toBe("1/3");
    expect(body.trainer).toEqual(DEFAULT_TRAINER);
  });

  it("R4.12 another body for the same class (the catalog changed) sends another key", async () => {
    const script = {
      "GET /api/v1/drills": [NO_DRILLS],
      "POST /api/v1/drills": [jsonResponse(201, { ...fixtureDrill, id: CREATED_ID })],
      [`GET /api/v1/drills/${CREATED_ID}`]: [jsonResponse(200, { ...fixtureDrill, id: CREATED_ID })],
    };
    const first = harness(script);
    await openClassDrill(first.deps, TARGET);
    const live = fixtureConfigs.find((entry) => entry.format === "live") as GameConfig;
    const second = harness(script, [...fixtureConfigs, { ...live, config_id: "cfg_live_110", depth_cbb: 11_000 }]);
    await openClassDrill(second.deps, TARGET);
    expect(postKeys(first.recorded)).toHaveLength(1);
    expect(postKeys(second.recorded)).toHaveLength(1);
    expect(postKeys(first.recorded)[0]).not.toBe(postKeys(second.recorded)[0]);
  });

  it("R4.12 a replayed create whose drill was deleted (404 on the read back) retries once under a fresh key", async () => {
    const { fake, recorded, deps } = harness({
      "GET /api/v1/drills": [NO_DRILLS],
      "POST /api/v1/drills": [jsonResponse(201, { ...fixtureDrill, id: CREATED_ID }), jsonResponse(201, { ...fixtureDrill, id: RETRIED_ID })],
      [`GET /api/v1/drills/${CREATED_ID}`]: [problemResponse(404, "not-found")],
    });
    await expect(openClassDrill(deps, TARGET)).resolves.toEqual({ kind: "opened", drillId: RETRIED_ID, created: true });
    const post = fake.calls.find((call) => call.method === "POST");
    expect(postKeys(recorded)).toEqual([`auto-drill-${SHA256_OF_ABC}-${await bodyHashOf(post?.body)}`, `auto-drill-${SHA256_OF_ABC}-${FRESH_SUFFIX}`]);
  });

  it("R4.12 a key-reuse refusal (422 idempotency-mismatch) retries once under a fresh key", async () => {
    const { recorded, deps } = harness({
      "GET /api/v1/drills": [NO_DRILLS],
      "POST /api/v1/drills": [problemResponse(422, "idempotency-mismatch"), jsonResponse(201, { ...fixtureDrill, id: RETRIED_ID })],
    });
    await expect(openClassDrill(deps, TARGET)).resolves.toEqual({ kind: "opened", drillId: RETRIED_ID, created: true });
    expect(postKeys(recorded)).toHaveLength(2);
    expect(postKeys(recorded)[1]).toBe(`auto-drill-${SHA256_OF_ABC}-${FRESH_SUFFIX}`);
  });

  it("R4.12 retries only once, and never on a request still in flight (409)", async () => {
    const twice = harness({
      "GET /api/v1/drills": [NO_DRILLS],
      "POST /api/v1/drills": [problemResponse(422, "idempotency-mismatch"), problemResponse(422, "idempotency-mismatch")],
    });
    expect(((await openClassDrill(twice.deps, TARGET).catch((error: unknown) => error)) as ApiProblem).slug).toBe("idempotency-mismatch");
    expect(postKeys(twice.recorded)).toHaveLength(2);
    const inFlight = harness({ "GET /api/v1/drills": [NO_DRILLS], "POST /api/v1/drills": [problemResponse(409, "idempotency-in-flight")] });
    expect(((await openClassDrill(inFlight.deps, TARGET).catch((error: unknown) => error)) as ApiProblem).status).toBe(409);
    expect(postKeys(inFlight.recorded)).toHaveLength(1);
  });

  it("R4.12 a failed read back other than 404 rejects without a retry", async () => {
    const { recorded, deps } = harness({
      "GET /api/v1/drills": [NO_DRILLS],
      "POST /api/v1/drills": [jsonResponse(201, { ...fixtureDrill, id: CREATED_ID })],
      [`GET /api/v1/drills/${CREATED_ID}`]: [problemResponse(500, "internal")],
    });
    expect(((await openClassDrill(deps, TARGET).catch((error: unknown) => error)) as ApiProblem).status).toBe(500);
    expect(postKeys(recorded)).toHaveLength(1);
  });

  it("R4.12 a body the write rules refuse is never sent", async () => {
    const tooDeep = [config({ config_id: "cfg_6_online_1500", depth_cbb: 150_000 })];
    const { fake, deps } = harness({ "GET /api/v1/drills": [jsonResponse(200, { items: [], next_cursor: null })] }, tooDeep);
    const result = await openClassDrill(deps, { ...TARGET, spot: { ...ONLINE_100, depthBand: "deep" } });
    expect(result.kind).toBe("refused");
    expect(unopenedText(result as Exclude<typeof result, { kind: "opened" }>)).toMatch(/^Could not open a drill: /);
    expect(unopenedText({ kind: "no-config" })).toBe("No covered configuration matches this spot");
    expect(fake.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("R4.12 creates nothing when no covered configuration matches", async () => {
    const { fake, deps } = harness({ "GET /api/v1/drills": [jsonResponse(200, { items: [], next_cursor: null })] });
    await expect(openClassDrill(deps, { ...TARGET, spot: { ...ONLINE_100, depthBand: "150" } })).resolves.toEqual({ kind: "no-config" });
    await expect(openClassDrill(deps, { ...TARGET, spot: { ...ONLINE_100, format: "home" } })).resolves.toEqual({ kind: "no-config" });
    expect(fake.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("R4.12 a failed find or create rejects with the api problem", async () => {
    const failedFind = harness({ "GET /api/v1/drills": [problemResponse(500, "internal")] });
    await expect(openClassDrill(failedFind.deps, TARGET)).rejects.toBeInstanceOf(ApiProblem);
    const failedCreate = harness({
      "GET /api/v1/drills": [jsonResponse(200, { items: [], next_cursor: null })],
      "POST /api/v1/drills": [problemResponse(400, "validation")],
    });
    const failure = await openClassDrill(failedCreate.deps, TARGET).catch((error: unknown) => error);
    expect((failure as ApiProblem).status).toBe(400);
  });

  it("R4.12 failure text is the problem's title, or a plain network line", async () => {
    const offline = harness({ "GET /api/v1/drills": [networkFailure()] });
    const failure = await openClassDrill(offline.deps, TARGET).catch((error: unknown) => error);
    expect(openFailureText(failure)).toBe(`Could not open a drill: ${NETWORK_FAILED_TEXT}`);
    expect(openFailureText(new ApiProblem({ status: 400, slug: "validation", title: "Request validation failed" }))).toBe(
      "Could not open a drill: Request validation failed.",
    );
  });
});
