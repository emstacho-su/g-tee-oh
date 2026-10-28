/**
 * The holdout property (R4.13, O-276, 06 section 9): no holdout item is ever served in a drill or an
 * automated hand. 1,000 deals are derived (deriveAwaitHero over hand numbers 0 to 499 for a drill
 * state and 0 to 499 for an automated state) against the fixture solver-query, with a deliberately
 * dense holdout set: HELD_PER_NODE hand classes at each spot's decision node, through the guard the
 * hook part loads (holdout/guard.ts holdoutGuardOf). No derived hand's class at its node is held.
 * A hand known to collide (the unguarded derivation deals a held class) is dealt again with the
 * guard, at the same hand number.
 *
 * Nothing here writes, so it runs on the shared test database; the spots come from the class
 * catalog (Lane A's loadClassCatalog and heroSpotsOf), as automated sessions take them.
 */
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { heroSpotsOf, loadClassCatalog, type CatalogClass } from "../src/automated/class-catalog.js";
import type { Database } from "../src/db.js";
import { holdoutGuardOf } from "../src/holdout/guard.js";
import { EMPTY_HOLDOUT_GUARD, type HoldoutGuard } from "../src/sessions/holdout-guard.js";
import { deriveAwaitHero, type DeriveSettings } from "../src/sessions/derive.js";
import { solverPort, type SolverPort } from "../src/sessions/solver-port.js";
import { initialState, type LearningState, type PersistedState } from "../src/sessions/state.js";
import { appDatabase } from "./support/database.js";
import { fixtureSolverQuery } from "./support/solver-query.js";

const CONFIG = "cfg_6_online_100";
const PAIR = "BB-BTN";
const DEALS_PER_MODE = 500;
/** A dense set: this many hand classes held at each spot's node (of 169). */
const HELD_PER_NODE = 30;
const SEED = "0123456789abcdef";
const PORT_DEADLINE_MS = 60_000;
const LONG_TEST_MS = 600_000;
const TEST_REQUEST = { id: "r4.13-holdout-property" } as FastifyRequest;
const SPOT = { preflop_action: ["rfi" as const], hands: { mode: "all" as const }, alternate_seats: false };

let database: Database;
let rfi: CatalogClass;
let facingOpen: CatalogClass;
let held: { solutionId: string; nodeKey: string; hand: string }[];

function port(): SolverPort {
  return solverPort(fixtureSolverQuery(), TEST_REQUEST, { deadlineMs: PORT_DEADLINE_MS });
}

function classOf(classes: readonly CatalogClass[], family: string): CatalogClass {
  const found = classes.find((cls) => cls.family === family && cls.options.some((option) => option.pair === PAIR));
  if (found === undefined) {
    throw new Error(`the fixture catalog has no ${family} class at ${PAIR}`);
  }
  return found;
}

async function denseItems(cls: CatalogClass): Promise<typeof held> {
  const option = cls.options.find((candidate) => candidate.pair === PAIR);
  const spot = option?.spots[0];
  if (option === undefined || spot === undefined) {
    throw new Error(`class ${cls.spotClassKey} has no spot`);
  }
  const node = await port().node(option.solutionId, spot.start_node_key);
  return node.hands.slice(0, HELD_PER_NODE).map((row) => ({ solutionId: option.solutionId, nodeKey: spot.start_node_key, hand: row.hand }));
}

function automatedLearning(cls: CatalogClass): LearningState {
  return {
    kind: "automated",
    seeded: false,
    config_ids: [CONFIG],
    pick_no: 1,
    queue: { last_family: null, hypercorrection: [] },
    block: { spot_class_key: cls.spotClassKey, family: cls.family, track_key: cls.trackKey, worked_example: false, served: 0, size: 3 },
  };
}

function settings(guard: HoldoutGuard): DeriveSettings {
  return { stopRule: "after_action", rng: false, holdoutGuard: guard };
}

async function derivedClass(state: PersistedState, handNo: number, guard: HoldoutGuard) {
  const derived = await deriveAwaitHero({ ...state, hand_no: handNo }, settings(guard), port());
  return { solutionId: derived.hand.solution_id, nodeKey: derived.node.node_key, hand: derived.node.hands[0]?.hand ?? "" };
}

beforeAll(async () => {
  database = appDatabase();
  const catalog = await loadClassCatalog(fixtureSolverQuery(), database, [CONFIG]);
  rfi = classOf(catalog.classes, "rfi");
  facingOpen = classOf(catalog.classes, "facing-open");
  held = [...(await denseItems(rfi)), ...(await denseItems(facingOpen))];
}, LONG_TEST_MS);

afterAll(async () => {
  await database.destroy();
});

describe("R4.13 no holdout item is served in a drill or automated deal", () => {
  const states = (): { mode: string; state: PersistedState }[] => [
    { mode: "drill", state: initialState(SEED, heroSpotsOf(rfi).filter((spot) => spot.pair === PAIR), SPOT) },
    { mode: "automated", state: initialState(SEED, heroSpotsOf(facingOpen).filter((spot) => spot.pair === PAIR), SPOT, { learning: automatedLearning(facingOpen) }) },
  ];

  it(
    "R4.13 1,000 drill and automated deals against a dense holdout set serve no held item",
    async () => {
      const guard = holdoutGuardOf(held);
      let derivations = 0;
      for (const { mode, state } of states()) {
        for (let handNo = 0; handNo < DEALS_PER_MODE; handNo += 1) {
          const dealt = await derivedClass(state, handNo, guard);
          expect(guard.isHeldOut(dealt.solutionId, dealt.nodeKey, dealt.hand), `${mode} hand ${handNo} served ${dealt.hand}`).toBe(false);
          derivations += 1;
        }
      }
      expect(derivations).toBe(2 * DEALS_PER_MODE);
    },
    LONG_TEST_MS,
  );

  it(
    "R4.13 a hand known to collide with the holdout set is dealt again at the same hand number",
    async () => {
      const guard = holdoutGuardOf(held);
      const [{ state }] = states() as [{ mode: string; state: PersistedState }];
      let collision: number | undefined;
      for (let handNo = 0; handNo < DEALS_PER_MODE && collision === undefined; handNo += 1) {
        const unguarded = await derivedClass(state, handNo, EMPTY_HOLDOUT_GUARD);
        if (guard.isHeldOut(unguarded.solutionId, unguarded.nodeKey, unguarded.hand)) {
          collision = handNo;
        }
      }
      expect(collision, "no hand of the first 500 hits a dense holdout set").toBeDefined();
      const handNo = collision ?? 0;
      const unguarded = await derivedClass(state, handNo, EMPTY_HOLDOUT_GUARD);
      const guarded = await derivedClass(state, handNo, guard);
      expect(guard.isHeldOut(unguarded.solutionId, unguarded.nodeKey, unguarded.hand)).toBe(true);
      expect(guard.isHeldOut(guarded.solutionId, guarded.nodeKey, guarded.hand)).toBe(false);
      expect(guarded.hand).not.toBe(unguarded.hand);
      const derived = await deriveAwaitHero({ ...state, hand_no: handNo }, settings(guard), port());
      expect(derived.state.hand_no).toBe(handNo);
    },
    LONG_TEST_MS,
  );
});
