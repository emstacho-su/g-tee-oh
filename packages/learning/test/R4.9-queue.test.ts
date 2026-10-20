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

  it.todo(
    "R4.9 interleave rule: 1,000 seeded picks (seed 20261020) over two equal-priority families alternate, 500 each, with no two consecutive picks from one family",
  );
  it.todo(
    "R4.9 interleave rule: 1,000 seeded picks over families with priorities 3, 2 and 1 have no two consecutive picks from one family and land within 50 picks of 409, 364 and 227",
  );
  it.todo(
    "R4.9 interleave rule degenerate case: with one family only the rule relaxes and the family repeats rather than deadlocking (proposed, S30 confirms)",
  );
  it.todo("R4.9 priority = leak cost x overdue factor: 4.5 x 1.5 gives 6.75 (A6 section 3)");
  it.todo(
    "R4.9 never-practiced classes start from the frequency prior: a class with no leak_stat row takes priority from its 5.25 per 1,000 reach prior (ADR 0013)",
  );
  it.todo(
    "R4.9 first exposure is a worked example: the first pick of a new class is served with panels visible and rated false (A6 section 3)",
  );
  it.todo(
    "R4.9 hypercorrection: a confident miss is the next pick regardless of priority, and the interleave rule still holds across it (05 section 5)",
  );
  it.todo(
    "R4.9 the picker's only randomness is the injected RandomSource: the same seed replays the same 1,000 picks (A1 section 2)",
  );
  it.todo("R4.9 the picker returns a new queue state and never mutates the cards or leak stats it reads");
});
