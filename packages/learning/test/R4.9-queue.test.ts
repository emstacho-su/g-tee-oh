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

import type { ConfidenceAttempt } from "../src/calibration.js";
import { emptyQueueState, pickNext, queuePriority, recordAttempt } from "../src/queue.js";
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
  const CONFIDENT_MISS: ConfidenceAttempt = { confidence: "sure", label: "Blunder" };
  const UNSURE_MISS: ConfidenceAttempt = { confidence: "unsure", label: "Mistake" };
  const HYPERCORRECTION_RUN_PICKS = 300;
  const MISS_ON_PICKED_EVERY = 5;
  const MISS_ON_LOW_EVERY = 7;

  /** A fourth family at a very low priority: only hypercorrection serves it often. */
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

  it.todo(
    "R4.9 never-practiced classes start from the frequency prior: a class with no leak_stat row takes priority from its 5.25 per 1,000 reach prior (ADR 0013)",
  );

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

  it("R4.9 hypercorrection: a confident miss is the next pick regardless of priority, and the interleave rule still holds across it (05 section 5)", () => {
    const candidates = [...candidatesOf(INTERLEAVE_THREE_FAMILY_FIXTURE.classes), LOW_PRIORITY_CLASS];
    const random = seededRandom();
    const rfiKey = INTERLEAVE_THREE_FAMILY_FIXTURE.classes[0]?.spotClass ?? "";

    // A miss outside the family just played is the very next pick, whatever its priority.
    const afterRfi: QueueState = { lastFamily: "rfi", hypercorrection: [] };
    const lowMissed = recordAttempt(afterRfi, LOW_PRIORITY_CLASS.spotClassKey, CONFIDENT_MISS);
    expect(lowMissed.hypercorrection).toEqual([LOW_PRIORITY_CLASS.spotClassKey]);
    const served = pickNext(lowMissed, candidates, random);
    expect(served.pick.spotClassKey).toBe(LOW_PRIORITY_CLASS.spotClassKey);
    expect(served.pick.reason).toBe("hypercorrection");
    expect(served.state.hypercorrection).toEqual([]);

    // A miss in the family just played waits exactly one pick.
    const rfiMissed = recordAttempt(afterRfi, rfiKey, CONFIDENT_MISS);
    const between = pickNext(rfiMissed, candidates, random);
    expect(between.pick.family).not.toBe("rfi");
    expect(between.pick.reason).toBe("priority");
    const later = pickNext(between.state, candidates, random);
    expect(later.pick.spotClassKey).toBe(rfiKey);
    expect(later.pick.reason).toBe("hypercorrection");

    // A long seeded run: every miss is served at the first pick the interleave rule allows.
    const familyOf = new Map(candidates.map((candidate) => [candidate.spotClassKey, candidate.family]));
    let state = emptyQueueState();
    const picks: QueuePick[] = [];
    for (let step = 0; step < HYPERCORRECTION_RUN_PICKS; step += 1) {
      const allowed = state.hypercorrection.find((key) => familyOf.get(key) !== state.lastFamily);
      const next = pickNext(state, candidates, random);
      expect(next.pick.spotClassKey).toBe(allowed ?? next.pick.spotClassKey);
      expect(next.pick.reason).toBe(allowed === undefined ? "priority" : "hypercorrection");
      picks.push(next.pick);
      const pickedMissed = step % MISS_ON_PICKED_EVERY === 0;
      state = recordAttempt(next.state, next.pick.spotClassKey, pickedMissed ? CONFIDENT_MISS : UNSURE_MISS);
      if (step % MISS_ON_LOW_EVERY === 0) {
        state = recordAttempt(state, LOW_PRIORITY_CLASS.spotClassKey, CONFIDENT_MISS);
      }
      // Never more than one pending miss per family can wait, so the list stays short.
      expect(state.hypercorrection.length).toBeLessThanOrEqual(2);
    }
    expectNoConsecutiveFamily(picks);
    const lowServed = picks.filter((pick) => pick.spotClassKey === LOW_PRIORITY_CLASS.spotClassKey);
    expect(lowServed.length).toBeGreaterThanOrEqual(Math.floor(HYPERCORRECTION_RUN_PICKS / MISS_ON_LOW_EVERY));
  });

  it("R4.9 the picker's only randomness is the injected RandomSource: the same seed replays the same 1,000 picks (A1 section 2)", () => {
    const candidates = candidatesOf(INTERLEAVE_THREE_FAMILY_FIXTURE.classes);
    const first = runPicks(candidates, INTERLEAVE_PICK_COUNT, seededRandom());
    const second = runPicks(candidates, INTERLEAVE_PICK_COUNT, seededRandom());
    expect(second.picks).toEqual(first.picks);
    const other = runPicks(candidates, INTERLEAVE_PICK_COUNT, splitMix64Source(BigInt(INTERLEAVE_SEED + 1)));
    expect(other.picks).not.toEqual(first.picks);

    // Exactly one draw per priority pick and none for a hypercorrection pick.
    let draws = 0;
    const counting: RandomSource = () => {
      draws += 1;
      return 0.5;
    };
    const priorityPick = pickNext(emptyQueueState(), candidates, counting);
    expect(draws).toBe(1);
    const missed = recordAttempt(priorityPick.state, LOW_PRIORITY_CLASS.spotClassKey, CONFIDENT_MISS);
    pickNext(missed, [...candidates, LOW_PRIORITY_CLASS], counting);
    expect(draws).toBe(1);
  });

  it("R4.9 the picker returns a new queue state and never mutates the cards or leak stats it reads", () => {
    const candidates = Object.freeze(
      candidatesOf(INTERLEAVE_THREE_FAMILY_FIXTURE.classes).map((candidate) => Object.freeze(candidate)),
    );
    const snapshot = JSON.parse(JSON.stringify(candidates)) as unknown;
    const state: QueueState = Object.freeze({
      lastFamily: "rfi",
      hypercorrection: Object.freeze([LOW_PRIORITY_CLASS.spotClassKey]),
    });
    const next = pickNext(state, candidates, seededRandom());
    expect(next.state).not.toBe(state);
    expect(state).toEqual({ lastFamily: "rfi", hypercorrection: [LOW_PRIORITY_CLASS.spotClassKey] });
    expect(candidates).toEqual(snapshot);
    expect(Object.isFrozen(next.state)).toBe(true);
    expect(Object.isFrozen(next.state.hypercorrection)).toBe(true);
    expect(Object.isFrozen(next.pick)).toBe(true);
    const recorded = recordAttempt(state, "rfi/CO/100bb/online", CONFIDENT_MISS);
    expect(recorded).not.toBe(state);
    expect(Object.isFrozen(recorded)).toBe(true);
    expect(state.hypercorrection).toEqual([LOW_PRIORITY_CLASS.spotClassKey]);
    expect(recorded.hypercorrection).toEqual(["rfi/CO/100bb/online", LOW_PRIORITY_CLASS.spotClassKey]);
  });

  it("R4.9 recordAttempt keeps one entry per class, most recent first, and ignores attempts that are not confident misses (O-215)", () => {
    const once = recordAttempt(emptyQueueState(), "a", CONFIDENT_MISS);
    const twice = recordAttempt(recordAttempt(once, "b", CONFIDENT_MISS), "a", CONFIDENT_MISS);
    expect(twice.hypercorrection).toEqual(["a", "b"]);
    expect(recordAttempt(twice, "c", UNSURE_MISS).hypercorrection).toEqual(["a", "b"]);
    expect(recordAttempt(twice, "b", { confidence: "sure", label: "Best" }).hypercorrection).toEqual(["a", "b"]);
    expect(emptyQueueState()).toEqual({ lastFamily: null, hypercorrection: [] });
  });

  it("R4.9 a pending miss whose class is not on offer stays pending and the draw goes on by priority", () => {
    const candidates = candidatesOf(INTERLEAVE_TWO_FAMILY_FIXTURE.classes);
    const state: QueueState = { lastFamily: null, hypercorrection: ["gone/class"] };
    const next = pickNext(state, candidates, () => 0);
    expect(next.pick.reason).toBe("priority");
    expect(next.state.hypercorrection).toEqual(["gone/class"]);
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
    expect(() => pickNext({ lastFamily: 3 as unknown as string, hypercorrection: [] }, [good], () => 0)).toThrow(
      /state\.lastFamily/,
    );
    expect(() =>
      pickNext({ lastFamily: null, hypercorrection: "a" as unknown as string[] }, [good], () => 0),
    ).toThrow(/state\.hypercorrection/);
    expect(() => recordAttempt(state, "", CONFIDENT_MISS)).toThrow(/spotClassKey/);
    expect(() => recordAttempt(state, "a", { confidence: "maybe" as "sure", label: "Best" })).toThrow(RangeError);
    expect(() =>
      recordAttempt({ lastFamily: null, hypercorrection: [1 as unknown as string] }, "a", CONFIDENT_MISS),
    ).toThrow(/state\.hypercorrection/);
  });
});
