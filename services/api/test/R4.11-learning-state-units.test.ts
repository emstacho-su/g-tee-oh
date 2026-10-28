/**
 * Pure parts of the learning-state lane (R4.11, O-251, O-272 to O-275): the typical response time,
 * the schedule card's jsonb round trip, the read-path rating, stored labels, the job periods and
 * kinds, and the one post-grade unrate step with its OR merge across hook parts.
 */
import {
  GLICKO2_DEFAULTS,
  UNRATED_WEIGHT,
  applyInactivity,
  newSpotClassCard,
  reviewSpotClass,
  type GradeOutput,
} from "@g-tee-oh/learning";
import { describe, expect, it } from "vitest";

import { unrateStep } from "../src/grading/decide.js";
import { idleClosePeriod, IDLE_CLOSE_KIND } from "../src/jobs/idle-close.js";
import { leakHistoryPeriod, LEAK_HISTORY_KIND } from "../src/jobs/leak-history.js";
import { JOB_DEFINITIONS, JOB_KINDS } from "../src/jobs/registry.js";
import { composeLearningHooks, type DecisionContext } from "../src/learning/effects.js";
import { LEARNING_HOOK_PARTS } from "../src/learning/hooks.js";
import { spotClassCardOf, storedCardOf } from "../src/learning-state/fsrs-card.js";
import { ratingOnRead } from "../src/learning-state/rating-period.js";
import { gradeLabelOf } from "../src/learning-state/repository.js";
import { SHARED_EFFECTS_PART_NAME } from "../src/learning-state/shared-effects.js";
import {
  TYPICAL_RESPONSE_MS_DEFAULT,
  TYPICAL_RESPONSE_SAMPLE,
  medianMs,
  typicalResponseFrom,
} from "../src/learning-state/typical-time.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-27T12:00:00.000Z");
const ZONE = "America/New_York";

const RATED_OUTPUT: GradeOutput = {
  score: 0.9,
  label: "Correct",
  rated: true,
  weight: 1,
  gradedActionIndex: 1,
  followedRoll: null,
  bestActionIndexes: [1],
} as unknown as GradeOutput;

describe("R4.11 typical response time (O-273)", () => {
  it("R4.11 the median takes the middle value, or the mean of the middle two", () => {
    expect(medianMs([3000, 1000, 2000])).toBe(2000);
    expect(medianMs([4000, 1000, 2000, 3000])).toBe(2500);
    expect(() => medianMs([])).toThrow(RangeError);
  });

  it("R4.11 fewer than five earlier attempts give 8000 ms; the median covers at most the newest 20", () => {
    expect(typicalResponseFrom([100, 200, 300, 400])).toBe(TYPICAL_RESPONSE_MS_DEFAULT);
    expect(typicalResponseFrom([100, 200, 300, 400, 500])).toBe(300);
    const newestFirst = [...Array.from({ length: TYPICAL_RESPONSE_SAMPLE }, () => 1000), 99_000, 99_000, 99_000];
    expect(typicalResponseFrom(newestFirst)).toBe(1000);
  });
});

describe("R4.11 schedule_card.fsrs_state round trip (O-272)", () => {
  it("R4.11 a reviewed card survives jsonb with its dates and fields", () => {
    const reviewed = reviewSpotClass(newSpotClassCard("preflop/online/100/rfi/BB-BTN", NOW), "Good", NOW);
    const stored = JSON.parse(JSON.stringify(storedCardOf(reviewed))) as unknown;
    const back = spotClassCardOf(reviewed.spotClassKey, stored);
    expect(back.card).toEqual(reviewed.card);
    expect(back.card.due).toBeInstanceOf(Date);
    expect(back.card.last_review).toBeInstanceOf(Date);
  });

  it("R4.11 a malformed stored card fails loudly", () => {
    expect(() => spotClassCardOf("k", { due: "not a date" })).toThrow();
  });
});

describe("R4.11 ratings on read (O-251, O-259)", () => {
  it("R4.11 a rating updated 21 days ago reads with 3 empty periods and is not changed otherwise", () => {
    const stored = { mu: 1600, rd: 80, volatility: 0.06, updatedAt: new Date(NOW.getTime() - 21 * DAY_MS) };
    const expected = applyInactivity({ rating: 1600, rd: 80, volatility: 0.06 }, 3);
    expect(ratingOnRead(stored, NOW)).toEqual(expected);
    expect(ratingOnRead({ ...stored, updatedAt: new Date(NOW.getTime() - 6 * DAY_MS) }, NOW)).toEqual(
      applyInactivity({ rating: 1600, rd: 80, volatility: 0.06 }, 0),
    );
    expect(ratingOnRead({ ...stored, mu: GLICKO2_DEFAULTS.rating, updatedAt: new Date(NOW.getTime() + DAY_MS) }, NOW).rd).toBe(80);
  });
});

describe("R4.11 stored labels", () => {
  it("R4.11 lowercase contract labels and learning labels both map to learning's label", () => {
    expect(gradeLabelOf("best")).toBe("Best");
    expect(gradeLabelOf("blunder")).toBe("Blunder");
    expect(gradeLabelOf("Mistake")).toBe("Mistake");
    expect(() => gradeLabelOf("great")).toThrow(RangeError);
  });
});

describe("R4.11 job periods and registration (O-275)", () => {
  it("R4.11 the weekly period is the Monday of the week that ended, due at the next Monday's local midnight", () => {
    // Tuesday 2026-10-27 in New York: the week that ended began Monday 2026-10-19.
    expect(leakHistoryPeriod(NOW, ZONE)).toEqual({ periodKey: "2026-10-19", runAt: new Date("2026-10-26T04:00:00.000Z") });
    // Sunday 23:30 local is still the week of the 26th; one minute past Monday midnight starts the next period.
    expect(leakHistoryPeriod(new Date("2026-11-02T04:30:00.000Z"), ZONE).periodKey).toBe("2026-10-19");
    expect(leakHistoryPeriod(new Date("2026-11-02T05:01:00.000Z"), ZONE)).toEqual({
      periodKey: "2026-10-26",
      runAt: new Date("2026-11-02T05:00:00.000Z"),
    });
  });

  it("R4.11 the idle closer's period is the quarter-hour holding now", () => {
    expect(idleClosePeriod(new Date("2026-10-27T12:44:59.999Z"))).toEqual({
      periodKey: "2026-10-27T12:30:00.000Z",
      runAt: new Date("2026-10-27T12:30:00.000Z"),
    });
  });

  it("R4.11 both jobs are registered under the registry's kinds", () => {
    expect(LEAK_HISTORY_KIND).toBe(JOB_KINDS.leakHistoryWeekly);
    expect(IDLE_CLOSE_KIND).toBe(JOB_KINDS.idleSessionClose);
    const kinds = JOB_DEFINITIONS.map((definition) => definition.kind);
    expect(kinds).toContain(JOB_KINDS.leakHistoryWeekly);
    expect(kinds).toContain(JOB_KINDS.idleSessionClose);
  });

  it("R4.11 the shared effects part runs first among the learning hooks", () => {
    expect(LEARNING_HOOK_PARTS[0]?.name).toBe(SHARED_EFFECTS_PART_NAME);
  });
});

describe("R4.11 the one post-grade unrate step (O-274, PM seed condition)", () => {
  it("R4.11 itemExcluded and forceUnrated each unrate with UNRATED_WEIGHT; neither leaves the output as graded", () => {
    expect(unrateStep(RATED_OUTPUT, {})).toEqual(RATED_OUTPUT);
    expect(unrateStep(RATED_OUTPUT, { itemExcluded: true, itemDifficulty: 1500 })).toEqual({
      ...RATED_OUTPUT,
      rated: false,
      weight: UNRATED_WEIGHT,
    });
    expect(unrateStep(RATED_OUTPUT, { forceUnrated: true })).toEqual({ ...RATED_OUTPUT, rated: false, weight: UNRATED_WEIGHT });
  });

  it("R4.11 a later part cannot undo an earlier part's unrate flags", async () => {
    const hooks = composeLearningHooks([
      { name: "first", beforeGrade: () => Promise.resolve({ itemExcluded: true, forceUnrated: true, trackIds: ["a"] }) },
      { name: "second", beforeGrade: () => Promise.resolve({ itemExcluded: false, forceUnrated: false, trackIds: ["b"] }) },
    ]);
    const overrides = await hooks.beforeGrade({} as DecisionContext);
    expect(overrides).toEqual({ itemExcluded: true, forceUnrated: true, trackIds: ["b"] });
  });
});
