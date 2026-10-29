/**
 * Why a decision is unrated, in one sentence beside the Unrated chip (S46, R3.13, O-272, O-276,
 * O-288, 06 section 3.6). Pure over the served feedback, prompt and session; the api's rating rules
 * are not recomputed, only named.
 */
import { describe, expect, it } from "vitest";

import type { DecisionFeedback, TrainerPrompt } from "../../src/contracts.js";
import { fixtureFeedback, fixturePrompt } from "../../src/fixtures/index.js";
import { fixturePracticeSession } from "../../src/fixtures/trainer.js";
import { REVEALING_PANELS } from "../../src/trainer/revealing-panels.js";
import type { PracticeSession } from "../../src/trainer/session-types.js";
import { UNRATED_REASONS, unratedReason } from "../../src/trainer/unrated-reason.js";

const CLEAN: DecisionFeedback = { ...fixtureFeedback, rated: false, noise_flags: [] };
const PLAIN_PROMPT: TrainerPrompt = { ...fixturePrompt, worked_example: false, visible_panels: [] };
const AUTOMATED: PracticeSession = { ...fixturePracticeSession, mode: "automated", rated_eligible: true, drill_id: null };

describe("R3.13 unrated reason", () => {
  it("R3.13 a rated decision has no reason", () => {
    expect(unratedReason({ ...fixtureFeedback, rated: true, noise_flags: [] }, PLAIN_PROMPT, AUTOMATED)).toBeNull();
  });

  it("R3.13 noise flags come first, whatever the session (R3.18)", () => {
    const flagged: DecisionFeedback = { ...CLEAN, noise_flags: ["close_ev_mix"] };
    expect(unratedReason(flagged, PLAIN_PROMPT, { ...AUTOMATED, mode: "drill" })).toBe(UNRATED_REASONS.noise);
  });

  it("R3.13 a drill session and a holdout retest are never rated", () => {
    expect(unratedReason(CLEAN, PLAIN_PROMPT, { ...AUTOMATED, mode: "drill", rated_eligible: false })).toBe(UNRATED_REASONS.drill);
    expect(unratedReason(CLEAN, PLAIN_PROMPT, { ...AUTOMATED, mode: "holdout", rated_eligible: false })).toBe(UNRATED_REASONS.holdout);
  });

  it("R3.13 an automated session started with a seed is never rated (O-288)", () => {
    expect(unratedReason(CLEAN, PLAIN_PROMPT, { ...AUTOMATED, rated_eligible: false })).toBe(UNRATED_REASONS.seeded);
  });

  it("R3.13 a worked example, then a revealing panel, then the rating rules (O-272, 06 section 3.6)", () => {
    expect(unratedReason(CLEAN, { ...PLAIN_PROMPT, worked_example: true }, AUTOMATED)).toBe(UNRATED_REASONS.workedExample);
    for (const panel of REVEALING_PANELS) {
      expect(unratedReason(CLEAN, { ...PLAIN_PROMPT, visible_panels: [panel] }, AUTOMATED)).toBe(UNRATED_REASONS.revealed);
    }
    expect(unratedReason(CLEAN, { ...PLAIN_PROMPT, visible_panels: ["hero_range_matrix"] }, AUTOMATED)).toBe(UNRATED_REASONS.rule);
    expect(unratedReason(CLEAN, PLAIN_PROMPT, AUTOMATED)).toBe(UNRATED_REASONS.rule);
  });

  it("R3.13 the revealing panels are the three the api names (grading/policy.ts ANSWER_REVEALING_PANELS)", () => {
    expect([...REVEALING_PANELS].sort()).toEqual(["action_frequency_table", "hero_strategy_matrix", "threshold_card"]);
  });
});
