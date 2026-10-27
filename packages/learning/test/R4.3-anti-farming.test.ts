/**
 * R4.3 anti-farming (S30; 06 section 3.6, ADR 0011, O-27, O-56, O-251). The five rated-flag rules
 * live in S22's grade(): automated mode only, first attempt only, no revealing panel, no noise
 * flag, under the daily cap of 150 per track. This file proves the other half: a decision those
 * rules unrate never reaches the rating, because rateSession keeps only rated decisions with a
 * positive weight and leaves the track identical when none remain. Rule 6 (no points for
 * participation, time spent or streaks) holds by construction: a SessionDecision carries only
 * difficulty, score, rated and weight, and the rows below show that annotations riding along and
 * any number of unrated decisions change nothing.
 *
 * Fixtures are synthetic: one rated automated preflop decision on a three-action node, and an item
 * difficulty computed from synthetic solver features.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { itemDifficulty } from "../src/difficulty.js";
import { rateSession } from "../src/glicko2.js";
import type { SessionDecision, TrackRating } from "../src/glicko2.js";
import { DAILY_RATED_CAP, grade } from "../src/grading.js";
import type { GradeInput, GradeMode, GradeOutput } from "../src/types.js";

/** A rated automated decision: call in the mix at loss 0.6 percent of the pot, above the floor. */
const RATED_INPUT: GradeInput = Object.freeze({
  lossPctPot: 0.6,
  floorPctPot: 0.2,
  freqByAction: Object.freeze([0, 0.4, 0.6]),
  actionIndex: 1,
  noiseFlags: Object.freeze([]),
  mode: "automated",
  firstAttempt: true,
  panelsRevealed: false,
  ratedTodayInTrack: 0,
  street: "preflop",
});

/** Synthetic solver features of the fixture node: a 1 percent gap and purity 0.7 give 1606.67. */
const ITEM = itemDifficulty({ evGapPctPot: 1, purity: 0.7, nActions: 3, mixed: true, allWithinFloor: false });

/** A track part way through calibration. */
const PLAYER: TrackRating = Object.freeze({ rating: 1540, rd: 180, volatility: 0.06 });

function decisionOf(output: GradeOutput, difficulty: number = ITEM.difficulty): SessionDecision {
  return { difficulty, score: output.score, rated: output.rated, weight: output.weight };
}

/** Each anti-farming rule broken alone, every other field as in the rated fixture. */
const BROKEN_RULES: readonly [string, GradeInput][] = [
  ["mode drill", { ...RATED_INPUT, mode: "drill" }],
  ["mode holdout", { ...RATED_INPUT, mode: "holdout" }],
  ["mode prediction", { ...RATED_INPUT, mode: "prediction" }],
  ["firstAttempt false", { ...RATED_INPUT, firstAttempt: false }],
  ["panelsRevealed true", { ...RATED_INPUT, panelsRevealed: true }],
  ["a noise flag", { ...RATED_INPUT, noiseFlags: ["close_ev_mix"] }],
  ["ratedTodayInTrack at the daily cap", { ...RATED_INPUT, ratedTodayInTrack: DAILY_RATED_CAP }],
];

/** Annotations a session record might carry that must never earn rating points (rule 6). */
type AnnotatedDecision = Readonly<{
  decision: SessionDecision;
  streakDays: number;
  responseMs: number;
  attempts: number;
}>;

const unratedDecision: fc.Arbitrary<SessionDecision> = fc.oneof(
  fc.record({
    difficulty: fc.double({ min: 1100, max: 1900, noNaN: true }),
    score: fc.double({ min: 0, max: 1, noNaN: true }),
    rated: fc.constant(false),
    weight: fc.constantFrom(0, 1),
  }),
  fc.record({
    difficulty: fc.double({ min: 1100, max: 1900, noNaN: true }),
    score: fc.double({ min: 0, max: 1, noNaN: true }),
    rated: fc.constant(true),
    weight: fc.constant(0),
  }),
);

describe("R4.3 anti-farming: unrated decisions never move the rating (06 section 3.6)", () => {
  it("R4.3 the fixture decision is rated and moves the rating, so the rows below test the rules and not the fixture", () => {
    const output = grade(RATED_INPUT);
    expect(output.rated).toBe(true);
    expect(ITEM.excluded).toBe(false);
    expect(ITEM.difficulty).toBeCloseTo(1606.6667, 3);
    expect(rateSession(PLAYER, [decisionOf(output)])).not.toEqual(PLAYER);
  });

  it.each(BROKEN_RULES)("R4.3 %s alone unrates the decision and rateSession leaves the track identical", (_rule, input) => {
    const output = grade(input);
    expect(output.rated).toBe(false);
    expect(output.weight).toBe(0);
    const after = rateSession(PLAYER, [decisionOf(output)]);
    expect(after).toEqual(PLAYER);
    expect(after).not.toBe(PLAYER);
  });

  it("R4.3 drills are never rated, whatever the other fields say", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 50, noNaN: true }),
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 0, max: DAILY_RATED_CAP * 2 }),
        (lossPctPot, firstAttempt, panelsRevealed, ratedTodayInTrack) => {
          const mode: GradeMode = "drill";
          const output = grade({ ...RATED_INPUT, lossPctPot, firstAttempt, panelsRevealed, ratedTodayInTrack, mode });
          expect(output.rated).toBe(false);
          expect(rateSession(PLAYER, [decisionOf(output)])).toEqual(PLAYER);
        },
      ),
    );
  });

  it("R4.3 a replayed session of repeats and drills leaves the track identical (O-251)", () => {
    const replay = [0.0, 0.3, 0.6, 2.5].flatMap((lossPctPot) => [
      decisionOf(grade({ ...RATED_INPUT, lossPctPot, actionIndex: 1, firstAttempt: false })),
      decisionOf(grade({ ...RATED_INPUT, lossPctPot, actionIndex: 1, mode: "drill" })),
    ]);
    expect(rateSession(PLAYER, replay)).toEqual(PLAYER);
  });
});

describe("R4.3 no points for participation, time spent or streaks (06 section 3.6 rule 6)", () => {
  const ratedDecisions: readonly SessionDecision[] = [0, 0.6, 3].map((lossPctPot) =>
    decisionOf(grade({ ...RATED_INPUT, lossPctPot })),
  );

  it("R4.3 decisions annotated with streak days, response time and attempt counts rate exactly as the bare rated results", () => {
    const annotated: AnnotatedDecision[] = ratedDecisions.map((decision, index) => ({
      decision,
      streakDays: 365 + index,
      responseMs: 900 * (index + 1),
      attempts: index + 1,
    }));
    const bare = rateSession(PLAYER, ratedDecisions);
    expect(rateSession(PLAYER, annotated.map((record) => record.decision))).toEqual(bare);
    const ridingAlong = annotated.map((record) => ({ ...record.decision, streakDays: record.streakDays, responseMs: record.responseMs }));
    expect(rateSession(PLAYER, ridingAlong)).toEqual(bare);
  });

  it("R4.3 adding any number of unrated decisions anywhere in the session changes nothing", () => {
    const bare = rateSession(PLAYER, ratedDecisions);
    fc.assert(
      fc.property(fc.array(unratedDecision, { maxLength: 200 }), fc.nat(), (extras, seed) => {
        const at = seed % (ratedDecisions.length + 1);
        const padded = [...ratedDecisions.slice(0, at), ...extras, ...ratedDecisions.slice(at)];
        expect(rateSession(PLAYER, padded)).toEqual(bare);
      }),
    );
  });

  it("R4.3 a session of only unrated decisions, however long, leaves rating, RD and volatility identical", () => {
    fc.assert(
      fc.property(fc.array(unratedDecision, { maxLength: 500 }), (extras) => {
        expect(rateSession(PLAYER, extras)).toEqual(PLAYER);
      }),
    );
  });
});
