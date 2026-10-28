/**
 * The automated loop's pure rules (R4.10, O-270, O-272, O-274, O-254, O-255, O-256, O-345, the PM
 * seed condition): the rated-rule overrides, the pick stream, the class catalog's merge and priors,
 * queue candidates and priorities from given learning rows, block picks under the interleave rule,
 * and the block's progress (the confident-miss rule O-215 was retired with R3.11, O-345).
 */
import {
  frequencyPriorPer1000,
  newSpotClassCard,
  overdueFactor,
  queuePriority,
  reviewSpotClass,
  startingLeakCost,
  DESIRED_RETENTION,
  MASTERED_RETENTION,
} from "@g-tee-oh/learning";
import { describe, expect, it } from "vitest";

import { isBlockComplete, recordDecision, withBlock } from "../src/automated/block.js";
import { buildClassCatalog, heroSpotsOf, type PairAnswer } from "../src/automated/class-catalog.js";
import { pickRandomSource } from "../src/automated/pick-stream.js";
import {
  classLeakCost,
  emptyLearningQueue,
  EMPTY_QUEUE_INPUTS,
  pickBlock,
  queueCandidates,
  REVIEW_BLOCK_INSTANCES,
  type QueueInputs,
} from "../src/automated/queue.js";
import { AUTOMATED_TRAINER_DEFAULTS, automatedSettings } from "../src/automated/settings.js";
import { ANSWER_REVEALING_PANELS } from "../src/grading/policy.js";
import { automatedGradeOverrides, isFirstAttempt } from "../src/learning/rated-rules.js";
import type { SqSpotClassEntry } from "../src/solver-query/client.js";
import type { AutomatedLearning } from "../src/sessions/state.js";

const SEED = "00000000deadbeef";
const NOW = new Date("2026-10-27T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function entry(key: string, family: string, hero: string, reach: number, overrides: Partial<SqSpotClassEntry> = {}): SqSpotClassEntry {
  return {
    spot_class_key: key,
    family,
    format: "online",
    depth_band: "100",
    table_size: 6,
    solution_id: "0190a0a0-0000-7000-8000-000000000001",
    line_reach: reach,
    spots: [
      {
        line: family === "rfi" ? null : "r250",
        start_node_key: `cfg/${key}`,
        hero_position: hero,
        pot_cbb: 350,
        line_reach: reach,
        history: family === "rfi" ? [] : [{ position: "BTN", token: "r250", label: "Raise to 2.5bb" }],
      },
    ],
    ...overrides,
  };
}

const RFI = entry("preflop/online/100/rfi/BB-BTN", "rfi", "BTN", 1);
const DEFEND = entry("preflop/online/100/facing-open/BB-BTN", "facing-open", "BB", 0.355);
const THREE_BET = entry("preflop/online/100/facing-3bet/BB-BTN", "facing-3bet", "BTN", 0.047);

function answer(configId: string, pair: string, classes: SqSpotClassEntry[], status: PairAnswer["status"] = "covered"): PairAnswer {
  return { configId, pair, tableSize: 6, status, spotClasses: classes };
}

const CATALOG = buildClassCatalog([
  answer("cfg_6_online_100", "BB-BTN", [RFI, DEFEND, THREE_BET]),
  answer("cfg_6_online_100", "SB-BB", [], "uncovered"),
  answer("cfg_6_online_100", "CO-BTN", [], "unavailable"),
]);

function learning(overrides: Partial<AutomatedLearning> = {}): AutomatedLearning {
  return {
    kind: "automated",
    seeded: false,
    config_ids: [],
    pick_no: 1,
    queue: emptyLearningQueue(),
    block: {
      spot_class_key: DEFEND.spot_class_key,
      family: "facing-open",
      track_key: "blind-defense",
      worked_example: false,
      served: 0,
      size: REVIEW_BLOCK_INSTANCES,
    },
    ...overrides,
  };
}

describe("R4.10 rated rules (O-274, PM seed condition)", () => {
  it("R4.10 first attempt means no earlier attempt at the item", () => {
    expect(isFirstAttempt(0)).toBe(true);
    expect(isFirstAttempt(1)).toBe(false);
    expect(() => isFirstAttempt(-1)).toThrow(RangeError);
  });

  it("R4.10 an automated decision grades in automated mode with the track's count and the block's panels", () => {
    expect(automatedGradeOverrides({ seeded: false, workedExample: false, earlierAttemptsAtItem: 0, ratedTodayInTrack: 7 })).toEqual({
      mode: "automated",
      firstAttempt: true,
      panelsRevealed: false,
      ratedTodayInTrack: 7,
    });
    expect(automatedGradeOverrides({ seeded: false, workedExample: true, earlierAttemptsAtItem: 2, ratedTodayInTrack: null })).toEqual({
      mode: "automated",
      firstAttempt: false,
      panelsRevealed: true,
    });
  });

  it("R4.10 a seeded session's decisions are forced unrated", () => {
    expect(automatedGradeOverrides({ seeded: true, workedExample: false, earlierAttemptsAtItem: 0, ratedTodayInTrack: 0 }).forceUnrated).toBe(true);
  });
});

describe("R4.10 pick stream (R3.6)", () => {
  it("R4.10 a pick's draw is a function of the seed and pick number", () => {
    const first = pickRandomSource(SEED, 3)();
    expect(pickRandomSource(SEED, 3)()).toBe(first);
    expect(pickRandomSource(SEED, 4)()).not.toBe(first);
    expect(pickRandomSource("00000000deadbeee", 3)()).not.toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
  });
});

describe("R4.10 class catalog (O-270)", () => {
  it("R4.10 sorts classes by key and splits pairs by coverage", () => {
    expect(CATALOG.classes.map((cls) => cls.family)).toEqual(["facing-3bet", "facing-open", "rfi"]);
    expect(CATALOG.coveredPairs).toEqual([{ configId: "cfg_6_online_100", pair: "BB-BTN" }]);
    expect(CATALOG.uncoveredPairs).toEqual([{ configId: "cfg_6_online_100", pair: "SB-BB" }]);
    expect(CATALOG.unavailablePairs).toEqual([{ configId: "cfg_6_online_100", pair: "CO-BTN" }]);
  });

  it("R4.10 a class takes its track from its family and hero seat, and solver-query's format and depth band", () => {
    const defend = CATALOG.byKey.get(DEFEND.spot_class_key);
    expect(defend).toMatchObject({ trackKey: "blind-defense", heroPosition: "BB", format: "online", depthBand: "100", meanPotBb: 3.5 });
    expect(CATALOG.byKey.get(RFI.spot_class_key)?.trackKey).toBe("opens");
  });

  it("R4.10 merges one class across configurations, its prior the mean over options", () => {
    const live = { ...DEFEND, table_size: 9, line_reach: 0.2 };
    const merged = buildClassCatalog([
      answer("cfg_6_online_100", "BB-BTN", [DEFEND]),
      { ...answer("cfg_9_live_13_100", "BB-BTN", [live]), tableSize: 9 },
    ]);
    const cls = merged.byKey.get(DEFEND.spot_class_key);
    expect(cls?.options.map((option) => option.configId)).toEqual(["cfg_6_online_100", "cfg_9_live_13_100"]);
    const expected = (frequencyPriorPer1000(6, 0.355) + frequencyPriorPer1000(9, 0.2)) / 2;
    expect(cls?.frequencyPriorPer1k).toBeCloseTo(expected, 10);
    expect(heroSpotsOf(cls!).map((spot) => spot.config_id)).toEqual(["cfg_6_online_100", "cfg_9_live_13_100"]);
  });

  it("R4.10 a reach rounded above 1 is read as 1", () => {
    const rounded = buildClassCatalog([answer("cfg", "BB-BTN", [{ ...RFI, line_reach: 1.0000001 }])]);
    expect(rounded.classes[0]?.frequencyPriorPer1k).toBeCloseTo(frequencyPriorPer1000(6, 1), 10);
  });

  it("R4.10 hero spots replay the class spot's line and history", () => {
    const spots = heroSpotsOf(CATALOG.byKey.get(DEFEND.spot_class_key)!);
    expect(spots).toEqual([
      {
        config_id: "cfg_6_online_100",
        pair: "BB-BTN",
        line: "r250",
        hero_seat: "BB",
        history: [{ position: "BTN", token: "r250", label: "Raise to 2.5bb", street: "preflop" }],
      },
    ]);
  });
});

describe("R4.10 queue candidates and priorities (O-254, O-255)", () => {
  const defend = CATALOG.byKey.get(DEFEND.spot_class_key)!;
  const rfi = CATALOG.byKey.get(RFI.spot_class_key)!;

  it("R4.10 a never-practiced class in an empty track starts at prior x 1 bb and is a first exposure", () => {
    const candidates = queueCandidates(CATALOG.classes, EMPTY_QUEUE_INPUTS, NOW);
    const candidate = candidates.find((one) => one.spotClassKey === defend.spotClassKey);
    expect(candidate).toEqual({
      spotClassKey: defend.spotClassKey,
      family: "facing-open",
      priority: queuePriority(startingLeakCost(defend.frequencyPriorPer1k, null), 1),
      firstExposure: true,
    });
  });

  it("R4.10 a stored leak cost and an overdue card set the priority; a mastered class uses the lower retention", () => {
    const reviewed = reviewSpotClass(newSpotClassCard(defend.spotClassKey, new Date(NOW.getTime() - 30 * DAY_MS)), "Good", new Date(NOW.getTime() - 20 * DAY_MS));
    const inputs: QueueInputs = {
      ...EMPTY_QUEUE_INPUTS,
      cards: new Map([[defend.spotClassKey, reviewed]]),
      leakCosts: new Map([[defend.spotClassKey, 4.5]]),
      pKnown: new Map([[defend.spotClassKey, 0.99]]),
    };
    const candidate = queueCandidates([defend], inputs, NOW)[0];
    const factor = overdueFactor(reviewed, NOW, { requestRetention: MASTERED_RETENTION });
    expect(candidate).toEqual({ spotClassKey: defend.spotClassKey, family: "facing-open", priority: queuePriority(4.5, factor), firstExposure: false });
    const unmastered = queueCandidates([defend], { ...inputs, pKnown: new Map() }, NOW)[0];
    expect(unmastered?.priority).toBeCloseTo(queuePriority(4.5, overdueFactor(reviewed, NOW, { requestRetention: DESIRED_RETENTION })), 10);
  });

  it("R4.10 a class without a leak stat takes its track's average", () => {
    const inputs: QueueInputs = { ...EMPTY_QUEUE_INPUTS, trackAverages: new Map([["opens", { missRate: 0.25, evPerMissBb: 2 }]]) };
    expect(classLeakCost(rfi, inputs)).toBeCloseTo(startingLeakCost(rfi.frequencyPriorPer1k, { missRate: 0.25, evPerMissBb: 2 }), 10);
  });
});

describe("R4.10 block picks (O-256, O-272, O-345)", () => {
  const candidates = queueCandidates(CATALOG.classes, EMPTY_QUEUE_INPUTS, NOW);

  it("R4.10 a first exposure is a worked-example block of three hands over the class's spots", () => {
    const pick = pickBlock({ seed: SEED, pickNo: 0, queue: emptyLearningQueue(), candidates, catalog: CATALOG });
    expect(pick.block).toMatchObject({ worked_example: true, served: 0, size: REVIEW_BLOCK_INSTANCES });
    expect(pick.pickNo).toBe(1);
    expect(pick.queue.last_family).toBe(pick.block.family);
    expect(pick.spots).toEqual(heroSpotsOf(CATALOG.byKey.get(pick.block.spot_class_key)!));
  });

  it("R4.10 no two consecutive blocks share a family while another family is on offer", () => {
    let queue = emptyLearningQueue();
    let family: string | null = null;
    for (let pickNo = 0; pickNo < 40; pickNo += 1) {
      const pick = pickBlock({ seed: SEED, pickNo, queue, candidates, catalog: CATALOG });
      expect(pick.block.family).not.toBe(family);
      family = pick.block.family;
      queue = pick.queue;
    }
  });

  it("R4.10 a decision only counts toward its block: the queue state is left as it was, whatever the label (O-345)", () => {
    const before = learning({ queue: { last_family: "facing-open" } });
    const after = recordDecision(before);
    expect(after.queue).toEqual({ last_family: "facing-open" });
    expect(after.block.served).toBe(before.block.served + 1);
    expect(before.block.served).toBe(0);
  });

  it("R4.10 a block completes at its size and the next block resets it", () => {
    let state = learning();
    for (let served = 0; served < REVIEW_BLOCK_INSTANCES; served += 1) {
      expect(isBlockComplete(state)).toBe(false);
      state = recordDecision(state);
    }
    expect(isBlockComplete(state)).toBe(true);
    const pick = pickBlock({ seed: SEED, pickNo: state.pick_no, queue: state.queue, candidates, catalog: CATALOG });
    const next = withBlock(state, pick);
    expect(next.block.served).toBe(0);
    expect(next.pick_no).toBe(state.pick_no + 1);
  });
});

describe("R4.10 automated settings (O-272)", () => {
  it("R4.10 one decision per hand, answer-revealing panels off, grouping and rng from the body", () => {
    expect(AUTOMATED_TRAINER_DEFAULTS.stop_rule).toBe("after_action");
    for (const panel of ANSWER_REVEALING_PANELS) {
      expect(AUTOMATED_TRAINER_DEFAULTS.panels[panel]).toBe(false);
    }
    expect(AUTOMATED_TRAINER_DEFAULTS.panels.hero_range_matrix).toBe(true);
    const settings = automatedSettings({ grouping: "simple", rng: true, stop_rule: "end_of_hand", panels: { threshold_card: true } });
    expect(settings).toMatchObject({ grouping: "simple", rng: true, stop_rule: "after_action" });
    expect(settings.panels.threshold_card).toBe(false);
  });
});
