/**
 * R4.9 queue selection vectors (R0.11 red half; the green half is S30 on p4/learning,
 * src/queue.ts).
 *
 * Rule (A6 sections 3 and 6, 06 section 4): priority per spot class = leak cost x overdue factor;
 * classes never practiced start from the frequency prior (ADR 0013); the next class is drawn with
 * the injected RandomSource (A1 section 2) in proportion to priority among the classes whose
 * action family differs from the last pick's, so no two consecutive picks share a family (the
 * interleave rule). The weighted draw is the assumed reading of "pick the next class" with an
 * injected RNG; a deterministic highest-priority pick would never serve the third family of the
 * second fixture, and S30 confirms the reading (see the README).
 *
 * Expected shares under the weighted draw are the stationary distribution of the Markov chain
 * over families: from family i the next family j is drawn with probability w_j / (W - w_i). For
 * priorities 3, 2, 1 that is 9/22, 8/22, 5/22. Families are the v1 action families of 06
 * section 2 spelled as keys.
 */
import { describe, expect, it } from "vitest";

import { overdueFactor } from "../src/fsrs.js";
import { classStat, leakStat, startingLeakCost, trackAverage } from "../src/leak-cost.js";
import { LEAK_COST_FLOOR_BB_PER_1000, emptyQueueState, pickNext, queuePriority } from "../src/queue.js";
import type { QueueCandidate, QueuePick, QueueState } from "../src/queue.js";
import { splitMix64Source } from "../src/random.js";
import type { RandomSource } from "../src/types.js";

export const INTERLEAVE_PICK_COUNT = 1000;

/** Seed of the injected RNG for the 1,000-pick runs; the same seed replays the same picks. */
export const INTERLEAVE_SEED = 20261020;

/** Allowed distance, in picks out of 1,000, between a family's count and its expected count. */
export const INTERLEAVE_SHARE_TOLERANCE_PICKS = 50;

export type QueueClassVector = { spotClass: string; family: string; priority: number };

/** Two families with equal priority: the rule forces strict alternation, 500 picks each. */
export const INTERLEAVE_TWO_FAMILY_FIXTURE = Object.freeze({
  classes: [
    { spotClass: "rfi/CO/100bb/online", family: "rfi", priority: 1 },
    { spotClass: "facing-open/BTN-vs-CO/100bb/online", family: "facing-open", priority: 1 },
  ] satisfies QueueClassVector[],
  expectedPicksByFamily: { rfi: 500, "facing-open": 500 },
  exact: true,
});

/** Three families with priorities 3, 2 and 1: stationary shares 9/22, 8/22 and 5/22. */
export const INTERLEAVE_THREE_FAMILY_FIXTURE = Object.freeze({
  classes: [
    { spotClass: "rfi/CO/100bb/online", family: "rfi", priority: 3 },
    { spotClass: "facing-open/BTN-vs-CO/100bb/online", family: "facing-open", priority: 2 },
    { spotClass: "facing-3bet/CO-vs-BTN/100bb/online", family: "facing-3bet", priority: 1 },
  ] satisfies QueueClassVector[],
  expectedSharesByFamily: { rfi: 9 / 22, "facing-open": 8 / 22, "facing-3bet": 5 / 22 },
  expectedPicksByFamily: { rfi: 409, "facing-open": 364, "facing-3bet": 227 },
  exact: false,
});

/** Priority = leak cost x overdue factor (A6 section 3). */
export const QUEUE_PRIORITY_ROW = Object.freeze({
  leakCostBbPer1000: 4.5,
  overdueFactor: 1.5,
  expectedPriority: 6.75,
});

/** A never-practiced class starts from its frequency prior (A6 section 3, ADR 0013). */
export const QUEUE_NEW_CLASS_ROW = Object.freeze({
  spotClass: "facing-3bet/CO-vs-BTN/100bb/online",
  frequencyPriorPer1000: 5.25,
  leakStatRows: 0,
});

describe("R4.9 queue selection and the interleave rule (S30, ADR 0012, ADR 0013)", () => {
  it("R0.11 queue vector data parses and the expected shares sum to one", () => {
    const shares = Object.values(INTERLEAVE_THREE_FAMILY_FIXTURE.expectedSharesByFamily);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 9);
    const picks = Object.values(INTERLEAVE_THREE_FAMILY_FIXTURE.expectedPicksByFamily);
    expect(picks.reduce((sum, count) => sum + count, 0)).toBe(INTERLEAVE_PICK_COUNT);
    const twoFamilyPicks = Object.values(INTERLEAVE_TWO_FAMILY_FIXTURE.expectedPicksByFamily);
    expect(twoFamilyPicks.reduce((sum, count) => sum + count, 0)).toBe(INTERLEAVE_PICK_COUNT);
    expect(QUEUE_PRIORITY_ROW.leakCostBbPer1000 * QUEUE_PRIORITY_ROW.overdueFactor).toBe(
      QUEUE_PRIORITY_ROW.expectedPriority,
    );
    const families = new Set(INTERLEAVE_THREE_FAMILY_FIXTURE.classes.map((row) => row.family));
    expect(families.size).toBe(3);
  });

  /** The fixture rows as queue candidates; none is a first exposure unless asked. */
  function candidatesOf(classes: readonly QueueClassVector[], firstExposure = false): QueueCandidate[] {
    return classes.map((row) => ({
      spotClassKey: row.spotClass,
      family: row.family,
      priority: row.priority,
      firstExposure,
    }));
  }

  /** count picks from a fresh state with one RNG; returns the picks in order and the final state. */
  function runPicks(
    candidates: readonly QueueCandidate[],
    count: number,
    random: RandomSource,
  ): { picks: QueuePick[]; state: QueueState } {
    let state = emptyQueueState();
    const picks: QueuePick[] = [];
    for (let index = 0; index < count; index += 1) {
      const next = pickNext(state, candidates, random);
      picks.push(next.pick);
      state = next.state;
    }
    return { picks, state };
  }

  function countByFamily(picks: readonly QueuePick[]): Record<string, number> {
    return picks.reduce<Record<string, number>>(
      (counts, pick) => ({ ...counts, [pick.family]: (counts[pick.family] ?? 0) + 1 }),
      {},
    );
  }

  function expectNoConsecutiveFamily(picks: readonly QueuePick[]): void {
    picks.slice(1).forEach((pick, index) => {
      expect(pick.family).not.toBe(picks[index]?.family);
    });
  }

  const seededRandom = (): RandomSource => splitMix64Source(BigInt(INTERLEAVE_SEED));

  /** A fourth family at a very low priority. */
  const LOW_PRIORITY_CLASS: QueueCandidate = {
    spotClassKey: "facing-4bet/BTN-vs-CO/100bb/online",
    family: "facing-4bet",
    priority: 0.001,
    firstExposure: false,
  };

  it("R4.9 interleave rule: 1,000 seeded picks (seed 20261020) over two equal-priority families alternate, 500 each, with no two consecutive picks from one family", () => {
    const candidates = candidatesOf(INTERLEAVE_TWO_FAMILY_FIXTURE.classes);
    const { picks } = runPicks(candidates, INTERLEAVE_PICK_COUNT, seededRandom());
    expect(picks).toHaveLength(INTERLEAVE_PICK_COUNT);
    expect(countByFamily(picks)).toEqual(INTERLEAVE_TWO_FAMILY_FIXTURE.expectedPicksByFamily);
    expectNoConsecutiveFamily(picks);
  });

  it("R4.9 interleave rule: 1,000 seeded picks over families with priorities 3, 2 and 1 have no two consecutive picks from one family and land within 50 picks of 409, 364 and 227", () => {
    const candidates = candidatesOf(INTERLEAVE_THREE_FAMILY_FIXTURE.classes);
    const { picks } = runPicks(candidates, INTERLEAVE_PICK_COUNT, seededRandom());
    expectNoConsecutiveFamily(picks);
    const counts = countByFamily(picks);
    for (const [family, expected] of Object.entries(INTERLEAVE_THREE_FAMILY_FIXTURE.expectedPicksByFamily)) {
      expect(Math.abs((counts[family] ?? 0) - expected)).toBeLessThanOrEqual(INTERLEAVE_SHARE_TOLERANCE_PICKS);
    }
  });

  it("R4.9 interleave rule degenerate case: with one family only the rule relaxes and the family repeats rather than deadlocking (proposed, S30 confirms)", () => {
    const candidates: QueueCandidate[] = [
      { spotClassKey: "rfi/CO/100bb/online", family: "rfi", priority: 1, firstExposure: false },
      { spotClassKey: "rfi/BTN/100bb/online", family: "rfi", priority: 1, firstExposure: false },
    ];
    const { picks, state } = runPicks(candidates, 100, seededRandom());
    expect(picks.every((pick) => pick.family === "rfi")).toBe(true);
    expect(new Set(picks.map((pick) => pick.spotClassKey)).size).toBe(2);
    expect(state.lastFamily).toBe("rfi");
  });

  it("R4.9 priority = leak cost x overdue factor: 4.5 x 1.5 gives 6.75 (A6 section 3)", () => {
    expect(queuePriority(QUEUE_PRIORITY_ROW.leakCostBbPer1000, QUEUE_PRIORITY_ROW.overdueFactor)).toBe(
      QUEUE_PRIORITY_ROW.expectedPriority,
    );
    expect(queuePriority(4.5, 0)).toBe(0);
    expect(() => queuePriority(-1, 1)).toThrow(/leakCostBbPer1000/);
    expect(() => queuePriority(1, Number.POSITIVE_INFINITY)).toThrow(/overdueFactor/);
  });

  it(
    "R4.9 never-practiced classes start from the frequency prior: a class with no leak_stat row takes priority from its 5.25 per 1,000 reach prior (ADR 0013)",
    () => {
      // Integration row (S30 step 3): leak cost from the leak-cost module, overdue factor from the
      // FSRS adapter, priority and the pick from the queue. A class with no leak_stat row and a track
      // with no decisions starts at prior x 1 bb (O-255); a class with no card has overdue factor 1
      // (O-254), so its priority is its 5.25 per 1,000 prior.
      const reviewTime = new Date(Date.UTC(2026, 10, 3, 12, 0, 0));
      const leakCostBbPer1000 = startingLeakCost(QUEUE_NEW_CLASS_ROW.frequencyPriorPer1000, trackAverage([]));
      const priority = queuePriority(leakCostBbPer1000, overdueFactor(null, reviewTime));
      expect(QUEUE_NEW_CLASS_ROW.leakStatRows).toBe(0);
      expect(priority).toBe(QUEUE_NEW_CLASS_ROW.frequencyPriorPer1000);

      // With track history the prior is scaled by the track's miss rate and EV per miss instead.
      const track = { missRate: 0.2, evPerMissBb: 1.5 };
      expect(queuePriority(startingLeakCost(QUEUE_NEW_CLASS_ROW.frequencyPriorPer1000, track), 1)).toBeCloseTo(
        5.25 * 0.2 * 1.5,
        12,
      );

      // The never-practiced class is served as a worked example: panels visible, unrated.
      const step = pickNext(
        emptyQueueState(),
        [{ spotClassKey: QUEUE_NEW_CLASS_ROW.spotClass, family: "facing-3bet", priority, firstExposure: true }],
        () => 0,
      );
      expect(step.pick).toMatchObject({ spotClassKey: QUEUE_NEW_CLASS_ROW.spotClass, panelsVisible: true, rated: false });
    },
  );

  it("R4.9 priority floor: a zero leak cost still gives LEAK_COST_FLOOR_BB_PER_1000 x overdue factor, so every due class keeps a chance (O-255)", () => {
    expect(LEAK_COST_FLOOR_BB_PER_1000).toBeGreaterThan(0);
    expect(queuePriority(0, 1)).toBe(LEAK_COST_FLOOR_BB_PER_1000);
    expect(queuePriority(0, 2)).toBeCloseTo(2 * LEAK_COST_FLOOR_BB_PER_1000, 12);
    expect(queuePriority(LEAK_COST_FLOOR_BB_PER_1000 / 2, 1)).toBe(LEAK_COST_FLOOR_BB_PER_1000);
    // A class that is not due yet (factor 0) stays out of the draw: the floor never overrides spacing.
    expect(queuePriority(0, 0)).toBe(0);
    expect(queuePriority(QUEUE_PRIORITY_ROW.leakCostBbPer1000, QUEUE_PRIORITY_ROW.overdueFactor)).toBe(6.75);
  });

  it("R4.9 a never-practiced class in a track with no misses is still drawn under a fixed seed (O-255, O-254)", () => {
    const cleanTrack = trackAverage([classStat([{ label: "Best", evLossBb: 0 }, { label: "Correct", evLossBb: 0 }])]);
    const newClassLeak = startingLeakCost(QUEUE_NEW_CLASS_ROW.frequencyPriorPer1000, cleanTrack);
    expect(newClassLeak).toBe(0);
    const newClass: QueueCandidate = {
      spotClassKey: QUEUE_NEW_CLASS_ROW.spotClass,
      family: "facing-3bet",
      priority: queuePriority(newClassLeak, overdueFactor(null, new Date(Date.UTC(2026, 10, 3)))),
      firstExposure: true,
    };
    const candidates = [
      { spotClassKey: "rfi/CO/100bb/online", family: "rfi", priority: queuePriority(4.5, 1), firstExposure: false },
      { spotClassKey: "facing-open/BTN-vs-CO/100bb/online", family: "facing-open", priority: queuePriority(4.5, 1), firstExposure: false },
      newClass,
    ];
    const { picks } = runPicks(candidates, INTERLEAVE_PICK_COUNT, splitMix64Source(BigInt(INTERLEAVE_SEED)));
    const served = picks.filter((pick) => pick.spotClassKey === newClass.spotClassKey);
    expect(served.length).toBeGreaterThan(0);
    expect(served[0]).toMatchObject({ firstExposure: true, panelsVisible: true, rated: false });
  });

  it("R4.9 a class played perfectly 30 or more times is still drawn when overdue (O-255, O-254)", () => {
    const perfect = leakStat(
      "bvb/SB-vs-BB/100bb/online",
      20,
      Array.from({ length: 40 }, () => ({ label: "Best" as const, evLossBb: 0 })),
      { missRate: 0.2, evPerMissBb: 1 },
    );
    expect(perfect.leakCostBbPer1k).toBe(0);
    const overdue: QueueCandidate = {
      spotClassKey: perfect.spotClassKey,
      family: "blind-vs-blind",
      priority: queuePriority(perfect.leakCostBbPer1k, 2),
      firstExposure: false,
    };
    const candidates = [
      { spotClassKey: "rfi/CO/100bb/online", family: "rfi", priority: queuePriority(4.5, 1), firstExposure: false },
      { spotClassKey: "facing-open/BTN-vs-CO/100bb/online", family: "facing-open", priority: queuePriority(4.5, 1), firstExposure: false },
      overdue,
    ];
    const { picks } = runPicks(candidates, INTERLEAVE_PICK_COUNT, splitMix64Source(BigInt(INTERLEAVE_SEED)));
    expect(picks.some((pick) => pick.spotClassKey === overdue.spotClassKey)).toBe(true);
    expectNoConsecutiveFamily(picks);
  });

  it("R4.9 first exposure is a worked example: the first pick of a new class is served with panels visible and rated false (A6 section 3)", () => {
    const fresh = pickNext(emptyQueueState(), [{ ...LOW_PRIORITY_CLASS, firstExposure: true }], () => 0);
    expect(fresh.pick).toEqual({
      spotClassKey: LOW_PRIORITY_CLASS.spotClassKey,
      family: LOW_PRIORITY_CLASS.family,
      firstExposure: true,
      panelsVisible: true,
      rated: false,
      reason: "priority",
    });
    const seen = pickNext(emptyQueueState(), [LOW_PRIORITY_CLASS], () => 0);
    expect(seen.pick.panelsVisible).toBe(false);
    expect(seen.pick.rated).toBe(true);
    expect(seen.pick.firstExposure).toBe(false);
  });

  it("R4.9 the picker's only randomness is the injected RandomSource: the same seed replays the same 1,000 picks (A1 section 2)", () => {
    const candidates = candidatesOf(INTERLEAVE_THREE_FAMILY_FIXTURE.classes);
    const first = runPicks(candidates, INTERLEAVE_PICK_COUNT, seededRandom());
    const second = runPicks(candidates, INTERLEAVE_PICK_COUNT, seededRandom());
    expect(second.picks).toEqual(first.picks);
    const other = runPicks(candidates, INTERLEAVE_PICK_COUNT, splitMix64Source(BigInt(INTERLEAVE_SEED + 1)));
    expect(other.picks).not.toEqual(first.picks);

    // Exactly one draw per pick: every pick is a priority draw since hypercorrection was retired (O-345).
    let draws = 0;
    const counting: RandomSource = () => {
      draws += 1;
      return 0.5;
    };
    const firstPick = pickNext(emptyQueueState(), candidates, counting);
    expect(draws).toBe(1);
    expect(firstPick.pick.reason).toBe("priority");
    pickNext(firstPick.state, [...candidates, LOW_PRIORITY_CLASS], counting);
    expect(draws).toBe(2);
  });

  it("R4.9 the picker returns a new queue state and never mutates the cards or leak stats it reads", () => {
    const candidates = Object.freeze(
      candidatesOf(INTERLEAVE_THREE_FAMILY_FIXTURE.classes).map((candidate) => Object.freeze(candidate)),
    );
    const snapshot = JSON.parse(JSON.stringify(candidates)) as unknown;
    const state: QueueState = Object.freeze({ lastFamily: "rfi" });
    const next = pickNext(state, candidates, seededRandom());
    expect(next.state).not.toBe(state);
    expect(state).toEqual({ lastFamily: "rfi" });
    expect(candidates).toEqual(snapshot);
    expect(Object.isFrozen(next.state)).toBe(true);
    expect(Object.isFrozen(next.pick)).toBe(true);
    expect(next.state).toEqual({ lastFamily: next.pick.family });
    expect(emptyQueueState()).toEqual({ lastFamily: null });
  });

  it("R4.9 the weighted draw walks cumulative priority, skips zero priorities, and is uniform when every priority is 0", () => {
    const candidates: QueueCandidate[] = [
      { spotClassKey: "a", family: "x", priority: 1, firstExposure: false },
      { spotClassKey: "b", family: "y", priority: 0, firstExposure: false },
      { spotClassKey: "c", family: "z", priority: 3, firstExposure: false },
    ];
    const pickAt = (draw: number, list: readonly QueueCandidate[]): string =>
      pickNext(emptyQueueState(), list, () => draw).pick.spotClassKey;
    expect(pickAt(0, candidates)).toBe("a");
    expect(pickAt(0.2499, candidates)).toBe("a");
    expect(pickAt(0.25, candidates)).toBe("c");
    expect(pickAt(0.9999999, candidates)).toBe("c");
    const zeros = candidates.map((candidate) => ({ ...candidate, priority: 0 }));
    expect(pickAt(0, zeros)).toBe("a");
    expect(pickAt(0.4, zeros)).toBe("b");
    expect(pickAt(0.9, zeros)).toBe("c");
  });

  it("R4.9 invalid input throws a RangeError naming the field", () => {
    const good: QueueCandidate = { spotClassKey: "a", family: "x", priority: 1, firstExposure: false };
    const state = emptyQueueState();
    const pick = (candidates: readonly QueueCandidate[], random: RandomSource = () => 0.5): unknown =>
      pickNext(state, candidates, random);
    expect(() => pick([])).toThrow(/candidates/);
    expect(() => pick("a" as unknown as QueueCandidate[])).toThrow(/candidates/);
    expect(() => pick([good, { ...good, family: "y" }])).toThrow(/candidates\[1\]\.spotClassKey.*duplicate/);
    expect(() => pick([{ ...good, priority: -1 }])).toThrow(/candidates\[0\]\.priority/);
    expect(() => pick([{ ...good, priority: Number.NaN }])).toThrow(/candidates\[0\]\.priority/);
    expect(() => pick([{ ...good, spotClassKey: "" }])).toThrow(/candidates\[0\]\.spotClassKey/);
    expect(() => pick([{ ...good, family: 7 as unknown as string }])).toThrow(/candidates\[0\]\.family/);
    expect(() => pick([{ ...good, firstExposure: "no" as unknown as boolean }])).toThrow(
      /candidates\[0\]\.firstExposure/,
    );
    expect(() => pick([good], () => 1)).toThrow(/random/);
    expect(() => pick([good], () => -0.1)).toThrow(/random/);
    expect(() => pick([good], () => Number.NaN)).toThrow(/random/);
    expect(() => pickNext({ lastFamily: 3 as unknown as string }, [good], () => 0)).toThrow(/state\.lastFamily/);
  });
});
