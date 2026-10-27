/**
 * R4.8 leak cost vectors (R0.11 red half; the green half is S30 on p4/learning, src/leak-cost.ts).
 *
 * Formula (06 section 6): leak_cost = frequency (spots per 1,000 hands) x miss rate (share of
 * decisions above the noise floor) x average EV (expected value) loss per miss in big blinds (bb),
 * giving bb lost per 1,000 hands. Frequency comes from the equilibrium reach prior (ADR 0013):
 * 1,000 x seat share (seat rotation) x reach probability of the line under equilibrium play. Miss
 * rate and EV per miss are shrunk toward the track average while a class has under 30 decisions.
 * All fixture numbers are toy values chosen for arithmetic that is easy to check by hand; nothing
 * here comes from any reference tool.
 */
import { describe, expect, it } from "vitest";

import {
  HANDS_PER_UNIT as SRC_HANDS_PER_UNIT,
  SHRINKAGE_MIN_DECISIONS,
  classStat,
  frequencyPriorPer1000,
  leakCost,
  leakHistorySnapshot,
  leakStat,
  rankLeaks,
  shrinkTowardTrack,
  startingLeakCost,
  trackAverage,
} from "../src/leak-cost.js";
import type { ClassStat, LeakDecision, LeakStat, TrackAverage } from "../src/leak-cost.js";
import type { GradeLabel } from "../src/types.js";
import { elementAt } from "../src/validate.js";

export const HANDS_PER_UNIT = 1000;

/** Classes with fewer decisions than this are shrunk toward the track average (06 section 6). */
export const LEAK_COST_SHRINKAGE_MIN_DECISIONS = 30;

export type ReachPriorRow = {
  spotClass: string;
  tableSize: number;
  seatShare: number;
  reachProbability: number;
  expectedPer1000: number;
};

/** Equilibrium reach prior rows (ADR 0013): expectedPer1000 = 1,000 x seatShare x reachProbability. */
export const REACH_PRIOR_ROWS: readonly ReachPriorRow[] = Object.freeze([
  {
    spotClass: "facing-open/BTN-vs-CO/100bb/online",
    tableSize: 6,
    seatShare: 1 / 6,
    reachProbability: 0.072,
    expectedPer1000: 12,
  },
  {
    spotClass: "facing-3bet/CO-vs-BTN/100bb/online",
    tableSize: 6,
    seatShare: 1 / 6,
    reachProbability: 0.0315,
    expectedPer1000: 5.25,
  },
  {
    spotClass: "facing-4bet/UTG-vs-BB/200bb/live",
    tableSize: 9,
    seatShare: 1 / 9,
    reachProbability: 0.018,
    expectedPer1000: 2,
  },
]);

/** The worked row: 12 x 0.25 x 1.5 = 4.5 bb per 1,000 hands. */
export const LEAK_COST_WORKED_ROW = Object.freeze({
  spotClass: "facing-open/BTN-vs-CO/100bb/online",
  frequencyPer1000: 12,
  decisions: 20,
  missesAboveFloor: 5,
  missRate: 0.25,
  evLossPerMissBb: 1.5,
  expectedLeakCostBbPer1000: 4.5,
});

/**
 * Shrinkage toward the track average under 30 decisions (06 section 6). The vault fixes the
 * threshold and the direction but not the weight; the bounds assertion holds for any weight rule,
 * and the linear weight n / 30, proposed by S05 and confirmed as O-257, gives the numbers in
 * proposedLinearWeight.
 */
export const LEAK_COST_SHRINKAGE_FIXTURE = Object.freeze({
  classDecisions: 20,
  classMissRate: 0.25,
  classEvLossPerMissBb: 1.5,
  trackMissRate: 0.15,
  trackEvLossPerMissBb: 1,
  frequencyPer1000: 12,
  proposedLinearWeight: {
    weightOnClass: 20 / 30,
    missRate: 0.2166666667,
    evLossPerMissBb: 1.3333333333,
    leakCostBbPer1000: 3.4666666667,
  },
  unshrunkFromDecisions: LEAK_COST_SHRINKAGE_MIN_DECISIONS,
});

/** A frequent small leak outranks a rare large one (06 section 6). */
export const LEAK_COST_RANKING_FIXTURE = Object.freeze([
  {
    spotClass: "rfi/CO/100bb/online",
    frequencyPer1000: 40,
    missRate: 0.1,
    evLossPerMissBb: 0.5,
    expectedLeakCostBbPer1000: 2,
  },
  {
    spotClass: "facing-4bet/UTG-vs-BB/200bb/live",
    frequencyPer1000: 2,
    missRate: 0.5,
    evLossPerMissBb: 1.5,
    expectedLeakCostBbPer1000: 1.5,
  },
]);

/** EV loss of a Correct decision inside the noise floor; it never counts toward EV per miss. */
const WITHIN_FLOOR_EV_LOSS_BB = 0.05;

const SHRINK = LEAK_COST_SHRINKAGE_FIXTURE;

const SHRINK_CLASS: ClassStat = Object.freeze({
  n: SHRINK.classDecisions,
  misses: 5,
  missRate: SHRINK.classMissRate,
  evPerMissBb: SHRINK.classEvLossPerMissBb,
});

const SHRINK_TRACK: TrackAverage = Object.freeze({
  missRate: SHRINK.trackMissRate,
  evPerMissBb: SHRINK.trackEvLossPerMissBb,
});

/** n decisions of which the first misses are Mistakes losing evPerMissBb each; the rest are Best. */
function decisionsOf(n: number, misses: number, evPerMissBb: number): LeakDecision[] {
  return Array.from({ length: n }, (_, index): LeakDecision =>
    index < misses ? { label: "Mistake", evLossBb: evPerMissBb } : { label: "Best", evLossBb: 0 },
  );
}

/** A leak_stat row with unshrunk values (n at the threshold) and its leak cost. */
function statOf(spotClassKey: string, frequencyPer1000: number, missRate: number, evPerMissBb: number): LeakStat {
  return {
    spotClassKey,
    freqPriorPer1k: frequencyPer1000,
    freqPersonalPer1k: null,
    n: LEAK_COST_SHRINKAGE_MIN_DECISIONS,
    missRate,
    evPerMissBb,
    leakCostBbPer1k: leakCost({ frequencyPer1000, missRate, evPerMissBb }),
  };
}

function expectRangeError(run: () => unknown, field: string): void {
  expect(run).toThrow(RangeError);
  expect(run).toThrow(field);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

describe("R4.8 leak cost from the equilibrium reach prior (S30, ADR 0013)", () => {
  it("R0.11 leak cost vector data parses and its arithmetic checks by hand", () => {
    for (const row of REACH_PRIOR_ROWS) {
      expect(HANDS_PER_UNIT * row.seatShare * row.reachProbability).toBeCloseTo(row.expectedPer1000, 9);
      expect(row.seatShare * row.tableSize).toBeCloseTo(1, 9);
    }
    const worked = LEAK_COST_WORKED_ROW;
    expect(worked.missesAboveFloor / worked.decisions).toBe(worked.missRate);
    expect(worked.frequencyPer1000 * worked.missRate * worked.evLossPerMissBb).toBe(
      worked.expectedLeakCostBbPer1000,
    );
    for (const row of LEAK_COST_RANKING_FIXTURE) {
      expect(row.frequencyPer1000 * row.missRate * row.evLossPerMissBb).toBeCloseTo(
        row.expectedLeakCostBbPer1000,
        9,
      );
    }
    expect(LEAK_COST_SHRINKAGE_FIXTURE.classDecisions).toBeLessThan(LEAK_COST_SHRINKAGE_MIN_DECISIONS);
  });

  it("R4.8 worked row: frequency 12 per 1,000 hands x miss rate 0.25 x 1.5 bb per miss gives 4.5 bb per 1,000 hands (06 section 6)", () => {
    const worked = LEAK_COST_WORKED_ROW;
    expect(SRC_HANDS_PER_UNIT).toBe(HANDS_PER_UNIT);
    const stat = classStat(decisionsOf(worked.decisions, worked.missesAboveFloor, worked.evLossPerMissBb));
    expect(stat).toEqual({ n: 20, misses: 5, missRate: worked.missRate, evPerMissBb: worked.evLossPerMissBb });
    expect(
      leakCost({ frequencyPer1000: worked.frequencyPer1000, missRate: stat.missRate, evPerMissBb: stat.evPerMissBb }),
    ).toBe(worked.expectedLeakCostBbPer1000);
  });

  it("R4.8 equilibrium reach prior: 1,000 x seat share x reach probability gives 12, 5.25 and 2 spots per 1,000 hands for the fixture lines (ADR 0013)", () => {
    for (const row of REACH_PRIOR_ROWS) {
      expect(frequencyPriorPer1000(row.tableSize, row.reachProbability)).toBeCloseTo(row.expectedPer1000, 9);
    }
    expect(frequencyPriorPer1000(2, 0)).toBe(0);
    expect(frequencyPriorPer1000(10, 1)).toBe(100);
  });

  it("R4.8 miss rate counts only decisions above the noise floor: 5 misses in 20 decisions give 0.25", () => {
    const decisions: readonly LeakDecision[] = [
      { label: "Inaccuracy", evLossBb: 1 },
      { label: "Mistake", evLossBb: 1.5 },
      { label: "Blunder", evLossBb: 2 },
      { label: "Mistake", evLossBb: 1.5 },
      { label: "Inaccuracy", evLossBb: 1.5 },
      ...Array.from({ length: 15 }, (_, index): LeakDecision => ({
        label: index % 2 === 0 ? "Best" : "Correct",
        evLossBb: index % 2 === 0 ? 0 : WITHIN_FLOOR_EV_LOSS_BB,
      })),
    ];
    const stat = classStat(decisions);
    expect(stat.n).toBe(20);
    expect(stat.misses).toBe(5);
    expect(stat.missRate).toBe(0.25);
    expect(stat.evPerMissBb).toBeCloseTo(1.5, 12);
  });

  it("R4.8 shrinkage under 30 decisions: a class with 20 decisions lands strictly between its own miss rate 0.25 and the track average 0.15, and likewise for EV per miss between 1.5 and 1.0", () => {
    const shrunk = shrinkTowardTrack(SHRINK_CLASS, SHRINK_TRACK);
    expect(shrunk.weightOnClass).toBeGreaterThan(0);
    expect(shrunk.weightOnClass).toBeLessThan(1);
    expect(shrunk.missRate).toBeGreaterThan(SHRINK.trackMissRate);
    expect(shrunk.missRate).toBeLessThan(SHRINK.classMissRate);
    expect(shrunk.evPerMissBb).toBeGreaterThan(SHRINK.trackEvLossPerMissBb);
    expect(shrunk.evPerMissBb).toBeLessThan(SHRINK.classEvLossPerMissBb);
  });

  it("R4.8 no shrinkage at 30 or more decisions: the class values are used unchanged", () => {
    expect(SHRINKAGE_MIN_DECISIONS).toBe(LEAK_COST_SHRINKAGE_MIN_DECISIONS);
    for (const n of [SHRINK.unshrunkFromDecisions, 40]) {
      const stat = classStat(decisionsOf(n, n / 5, 1.5));
      const shrunk = shrinkTowardTrack(stat, SHRINK_TRACK);
      expect(shrunk).toEqual({ weightOnClass: 1, missRate: 0.2, evPerMissBb: 1.5 });
      expect(leakStat("rfi/BTN/100bb/online", 12, decisionsOf(n, n / 5, 1.5), SHRINK_TRACK).leakCostBbPer1k).toBeCloseTo(
        12 * 0.2 * 1.5,
        12,
      );
    }
  });

  it("R4.8 linear weight n / 30, confirmed as O-257: 20 decisions give miss rate 0.2166666667, 1.3333333333 bb per miss and 3.4666666667 bb per 1,000 hands", () => {
    const expected = SHRINK.proposedLinearWeight;
    const shrunk = shrinkTowardTrack(SHRINK_CLASS, SHRINK_TRACK);
    expect(shrunk.weightOnClass).toBeCloseTo(expected.weightOnClass, 12);
    expect(shrunk.missRate).toBeCloseTo(expected.missRate, 9);
    expect(shrunk.evPerMissBb).toBeCloseTo(expected.evLossPerMissBb, 9);
    const stat = leakStat(
      LEAK_COST_WORKED_ROW.spotClass,
      SHRINK.frequencyPer1000,
      decisionsOf(SHRINK.classDecisions, 5, SHRINK.classEvLossPerMissBb),
      SHRINK_TRACK,
    );
    expect(stat.spotClassKey).toBe(LEAK_COST_WORKED_ROW.spotClass);
    expect(stat.freqPriorPer1k).toBe(SHRINK.frequencyPer1000);
    expect(stat.freqPersonalPer1k).toBeNull();
    expect(stat.n).toBe(SHRINK.classDecisions);
    expect(stat.missRate).toBeCloseTo(expected.missRate, 9);
    expect(stat.evPerMissBb).toBeCloseTo(expected.evLossPerMissBb, 9);
    expect(stat.leakCostBbPer1k).toBeCloseTo(expected.leakCostBbPer1000, 9);
  });

  it("R4.8 ranking: a frequent small leak (40 x 0.1 x 0.5 = 2.0) outranks a rare large one (2 x 0.5 x 1.5 = 1.5)", () => {
    const stats = LEAK_COST_RANKING_FIXTURE.map((row) => statOf(row.spotClass, row.frequencyPer1000, row.missRate, row.evLossPerMissBb));
    const ranked = rankLeaks([...stats].reverse());
    expect(ranked.map((stat) => stat.spotClassKey)).toEqual(LEAK_COST_RANKING_FIXTURE.map((row) => row.spotClass));
    ranked.forEach((stat, index) => {
      const row = elementAt(LEAK_COST_RANKING_FIXTURE, index, "LEAK_COST_RANKING_FIXTURE");
      expect(stat.leakCostBbPer1k).toBeCloseTo(row.expectedLeakCostBbPer1000, 12);
    });
  });

  it("R4.8 a class with zero decisions takes the track average and raises no division by zero", () => {
    expect(classStat([])).toEqual({ n: 0, misses: 0, missRate: 0, evPerMissBb: 0 });
    expect(shrinkTowardTrack(classStat([]), SHRINK_TRACK)).toEqual({
      weightOnClass: 0,
      missRate: SHRINK.trackMissRate,
      evPerMissBb: SHRINK.trackEvLossPerMissBb,
    });
    const stat = leakStat("facing-open/BTN-vs-CO/100bb/online", 12, [], SHRINK_TRACK);
    expect(stat.n).toBe(0);
    expect(stat.leakCostBbPer1k).toBeCloseTo(12 * 0.15 * 1, 12);
    // A track with no decisions is null, which startingLeakCost reads as no history (O-255).
    expect(trackAverage([])).toBeNull();
    expect(trackAverage([classStat([])])).toBeNull();
    expect(startingLeakCost(5.25, trackAverage([]))).toBe(5.25);
    // Decisions but no misses: a real zero miss rate, not missing history.
    expect(trackAverage([classStat(decisionsOf(10, 0, 0))])).toEqual({ missRate: 0, evPerMissBb: 0 });
  });

  it("R4.8 the computation returns new objects and never mutates the leak_stat rows it reads", () => {
    const decisions = deepFreeze(decisionsOf(20, 5, 1.5));
    const track = deepFreeze({ ...SHRINK_TRACK });
    const classStatInput = deepFreeze({ ...SHRINK_CLASS });
    const stats = deepFreeze([
      statOf("b", 12, 0.25, 1.5),
      statOf("a", 40, 0.1, 0.5),
      statOf("c", 2, 0.5, 1.5),
    ]);
    const before = structuredClone({ decisions, track, classStatInput, stats });
    const ranked = rankLeaks(stats);
    const rows = leakHistorySnapshot("2026-10-26", stats);
    expect(ranked).not.toBe(stats);
    expect(classStat(decisions)).not.toBe(classStatInput);
    expect(shrinkTowardTrack(classStatInput, track)).not.toBe(track);
    expect(trackAverage([classStatInput])).not.toBe(track);
    expect(leakStat("x", 12, decisions, track)).not.toBe(stats[0]);
    expect(rows[0]).not.toBe(stats[0]);
    expect({ decisions, track, classStatInput, stats }).toEqual(before);
  });

  it("R4.8 track average pools misses over decisions and weights EV per miss by misses", () => {
    const stats: readonly ClassStat[] = [
      SHRINK_CLASS,
      { n: 10, misses: 0, missRate: 0, evPerMissBb: 0 },
      { n: 30, misses: 4, missRate: 4 / 30, evPerMissBb: 0.375 },
    ];
    const track = trackAverage(stats);
    expect(track).not.toBeNull();
    expect(track?.missRate).toBeCloseTo(9 / 60, 12);
    expect(track?.evPerMissBb).toBeCloseTo(1, 12);
  });

  it("R4.8 a class with decisions but no misses takes the track EV per miss (O-257)", () => {
    const stat = classStat(decisionsOf(15, 0, 0));
    expect(stat).toEqual({ n: 15, misses: 0, missRate: 0, evPerMissBb: 0 });
    const shrunk = shrinkTowardTrack(stat, SHRINK_TRACK);
    expect(shrunk.weightOnClass).toBe(0.5);
    expect(shrunk.missRate).toBeCloseTo(0.5 * 0 + 0.5 * 0.15, 12);
    expect(shrunk.evPerMissBb).toBe(SHRINK.trackEvLossPerMissBb);
  });

  it("R4.8 starting leak cost of a never-practiced class: prior x track miss rate x track EV per miss, or prior x 1 bb with no track (O-255)", () => {
    expect(startingLeakCost(5.25, null)).toBe(5.25);
    expect(startingLeakCost(5.25, { missRate: 0.2, evPerMissBb: 1.5 })).toBeCloseTo(1.575, 12);
    expect(startingLeakCost(12, SHRINK_TRACK)).toBeCloseTo(leakStat("never", 12, [], SHRINK_TRACK).leakCostBbPer1k, 12);
  });

  it("R4.8 rankLeaks orders by leak cost descending and breaks ties by spot class key ascending", () => {
    const stats = [
      statOf("rfi/UTG/100bb/online", 10, 0.2, 1),
      statOf("rfi/CO/100bb/online", 10, 0.2, 1),
      statOf("rfi/BTN/100bb/online", 1, 0.2, 1),
      statOf("rfi/SB/100bb/online", 30, 0.2, 1),
      statOf("rfi/CO/100bb/online", 10, 0.2, 1),
    ];
    expect(rankLeaks(stats).map((stat) => stat.spotClassKey)).toEqual([
      "rfi/SB/100bb/online",
      "rfi/CO/100bb/online",
      "rfi/CO/100bb/online",
      "rfi/UTG/100bb/online",
      "rfi/BTN/100bb/online",
    ]);
    const early = statOf("a/tie", 10, 0.2, 1);
    const late = statOf("b/tie", 10, 0.2, 1);
    expect(rankLeaks([early, late])).toEqual([early, late]);
    expect(rankLeaks([late, early])).toEqual([early, late]);
    expect(rankLeaks([early, { ...early }])).toEqual([early, early]);
    expect(rankLeaks([])).toEqual([]);
  });

  it("R4.8 leak history snapshot: one row per class for the week services/api supplies (A4 leak_history, R4.11)", () => {
    const stats = [statOf("rfi/CO/100bb/online", 40, 0.1, 0.5), statOf("facing-4bet/UTG-vs-BB/200bb/live", 2, 0.5, 1.5)];
    const rows = leakHistorySnapshot("2026-10-26", stats);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ spotClassKey: "rfi/CO/100bb/online", week: "2026-10-26", leakCostBbPer1k: stats[0]?.leakCostBbPer1k });
    expect(rows[1]?.spotClassKey).toBe("facing-4bet/UTG-vs-BB/200bb/live");
    expect(leakHistorySnapshot("2026-10-26", [])).toEqual([]);
    for (const week of ["2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31", "2026-12-31"]) {
      expect(leakHistorySnapshot(week, stats)[0]?.week).toBe(week);
    }
  });

  it("R4.8 leak history snapshot rejects malformed weeks, impossible dates and a class listed twice", () => {
    const stats = [statOf("rfi/CO/100bb/online", 40, 0.1, 0.5)];
    for (const week of ["2023-02-29", "2100-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-10-00", "0000-01-01", "26-10-26", "2026-1-5", "2026-10-26T00:00", " 2026-10-26"]) {
      expectRangeError(() => leakHistorySnapshot(week, stats), "week");
    }
    expectRangeError(() => leakHistorySnapshot(20261026 as unknown as string, stats), "week");
    expectRangeError(() => leakHistorySnapshot("2026-10-26", [...stats, ...stats]), "stats[1].spotClassKey");
  });

  it("R4.8 every public function rejects out-of-range input with a RangeError naming the field", () => {
    const good = SHRINK_CLASS;
    const cases: readonly (readonly [() => unknown, string])[] = [
      [() => frequencyPriorPer1000(1, 0.5), "tableSize"],
      [() => frequencyPriorPer1000(11, 0.5), "tableSize"],
      [() => frequencyPriorPer1000(6.5, 0.5), "tableSize"],
      [() => frequencyPriorPer1000(6, -0.1), "reachProbability"],
      [() => frequencyPriorPer1000(6, 1.1), "reachProbability"],
      [() => frequencyPriorPer1000(6, Number.NaN), "reachProbability"],
      [() => classStat("nope" as unknown as LeakDecision[]), "decisions"],
      [() => classStat([null as unknown as LeakDecision]), "decisions[0]"],
      [() => classStat([{ label: "Great" as GradeLabel, evLossBb: 1 }]), "decisions[0].label"],
      [() => classStat([{ label: "Mistake", evLossBb: -1 }]), "decisions[0].evLossBb"],
      [() => classStat([{ label: "Best", evLossBb: Number.NaN }]), "decisions[0].evLossBb"],
      [() => trackAverage({} as unknown as ClassStat[]), "stats"],
      [() => trackAverage([null as unknown as ClassStat]), "stats[0]"],
      [() => trackAverage([{ ...good, n: 2.5 }]), "stats[0].n"],
      [() => trackAverage([{ ...good, misses: 21 }]), "stats[0].misses"],
      [() => trackAverage([{ ...good, missRate: 1.5 }]), "stats[0].missRate"],
      [() => trackAverage([{ ...good, evPerMissBb: -1 }]), "stats[0].evPerMissBb"],
      [() => shrinkTowardTrack({ ...good, n: -1 }, SHRINK_TRACK), "classStat.n"],
      [() => shrinkTowardTrack(good, { missRate: 2, evPerMissBb: 1 }), "track.missRate"],
      [() => shrinkTowardTrack(good, null as unknown as TrackAverage), "track"],
      [() => leakCost(null as unknown as Parameters<typeof leakCost>[0]), "input"],
      [() => leakCost({ frequencyPer1000: -1, missRate: 0.1, evPerMissBb: 1 }), "frequencyPer1000"],
      [() => leakCost({ frequencyPer1000: 1, missRate: 1.01, evPerMissBb: 1 }), "missRate"],
      [() => leakCost({ frequencyPer1000: 1, missRate: 0.1, evPerMissBb: Number.POSITIVE_INFINITY }), "evPerMissBb"],
      [() => leakStat("", 12, [], SHRINK_TRACK), "spotClassKey"],
      [() => leakStat(7 as unknown as string, 12, [], SHRINK_TRACK), "spotClassKey"],
      [() => leakStat("k", -1, [], SHRINK_TRACK), "freqPriorPer1k"],
      [() => leakStat("k", 12, [], { missRate: 0.1, evPerMissBb: -2 }), "track.evPerMissBb"],
      [() => startingLeakCost(Number.NaN, null), "freqPriorPer1k"],
      [() => startingLeakCost(5.25, { missRate: -0.1, evPerMissBb: 1 }), "track.missRate"],
      [() => rankLeaks("nope" as unknown as LeakStat[]), "stats"],
      [() => rankLeaks([{ ...statOf("a", 1, 0.1, 1), leakCostBbPer1k: Number.NaN }]), "stats[0].leakCostBbPer1k"],
      [() => rankLeaks([statOf("", 1, 0.1, 1)]), "stats[0].spotClassKey"],
      [() => rankLeaks([undefined as unknown as LeakStat]), "stats[0]"],
      [() => leakHistorySnapshot("2026-10-26", 3 as unknown as LeakStat[]), "stats"],
      [() => leakHistorySnapshot("2026-10-26", [{ ...statOf("a", 1, 0.1, 1), leakCostBbPer1k: -1 }]), "stats[0].leakCostBbPer1k"],
    ];
    for (const [run, field] of cases) {
      expectRangeError(run, field);
    }
  });
});
