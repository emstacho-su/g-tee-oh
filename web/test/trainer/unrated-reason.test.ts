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
import { UNRATED_REASONS, preDecisionReason, unratedReason } from "../../src/trainer/unrated-reason.js";

const CLEAN: DecisionFeedback = { ...fixtureFeedback, rated: false, noise_flags: [] };
const PLAIN_PROMPT: TrainerPrompt = { ...fixturePrompt, worked_example: false, visible_panels: [] };
const AUTOMATED: PracticeSession = { ...fixturePracticeSession, mode: "automated", rated_eligible: true, drill_id: null };

describe("R3.33 the pre-decision reason follows the chip's order (code review round 2, 5)", () => {
  const revealing: TrainerPrompt = { ...PLAIN_PROMPT, visible_panels: [...REVEALING_PANELS] };
  const worked: TrainerPrompt = { ...PLAIN_PROMPT, worked_example: true };

  it("R3.33 a plain prompt gives no reason, whatever the session", () => {
    expect(preDecisionReason(PLAIN_PROMPT, AUTOMATED)).toBeNull();
    expect(preDecisionReason(PLAIN_PROMPT, fixturePracticeSession)).toBeNull();
  });

  it("R3.33 the session's mode comes first, then an ineligible session's rating rule, then the prompt", () => {
    expect(preDecisionReason(revealing, fixturePracticeSession)).toBe(UNRATED_REASONS.drill);
    expect(preDecisionReason(worked, { ...AUTOMATED, mode: "holdout" })).toBe(UNRATED_REASONS.holdout);
    // Ineligible but not the seeded shape (no block): the rating rule, as the chip says after the decision.
    const ineligible: PracticeSession = { ...AUTOMATED, rated_eligible: false, automated: null };
    expect(preDecisionReason(revealing, ineligible)).toBe(UNRATED_REASONS.rule);
    expect(preDecisionReason(revealing, ineligible)).toBe(unratedReason(CLEAN, revealing, ineligible));
    expect(preDecisionReason(revealing, AUTOMATED)).toBe(UNRATED_REASONS.revealed);
    expect(preDecisionReason(worked, AUTOMATED)).toBe(UNRATED_REASONS.workedExample);
    expect(preDecisionReason(revealing, undefined)).toBe(UNRATED_REASONS.revealed);
  });
});

describe("R3.13 unrated reason", () => {
  it("R3.13 a rated decision has no reason", () => {
    expect(unratedReason({ ...fixtureFeedback, rated: true, noise_flags: [] }, PLAIN_PROMPT, AUTOMATED)).toBeNull();
  });

  it("R3.13 the session mode comes before a noise flag: a drill or a holdout retest is never rated, flagged or not (PR #45 review round 4, finding e)", () => {
    const flagged: DecisionFeedback = { ...CLEAN, noise_flags: ["close_ev_mix"] };
    expect(unratedReason(flagged, PLAIN_PROMPT, { ...AUTOMATED, mode: "drill", rated_eligible: false })).toBe(UNRATED_REASONS.drill);
    expect(unratedReason(flagged, PLAIN_PROMPT, { ...AUTOMATED, mode: "holdout", rated_eligible: false })).toBe(UNRATED_REASONS.holdout);
  });

  it("R3.13 in a session that could be rated, a noise flag is the reason (R3.18)", () => {
    const flagged: DecisionFeedback = { ...CLEAN, noise_flags: ["close_ev_mix"] };
    expect(unratedReason(flagged, PLAIN_PROMPT, AUTOMATED)).toBe(UNRATED_REASONS.noise);
  });

  it("R3.13 a drill session and a holdout retest are never rated", () => {
    expect(unratedReason(CLEAN, PLAIN_PROMPT, { ...AUTOMATED, mode: "drill", rated_eligible: false })).toBe(UNRATED_REASONS.drill);
    expect(unratedReason(CLEAN, PLAIN_PROMPT, { ...AUTOMATED, mode: "holdout", rated_eligible: false })).toBe(UNRATED_REASONS.holdout);
  });

  it("R3.13 an automated session started with a seed is never rated (O-288)", () => {
    const block = { spot_class_key: "class", track_key: "opens", family: "rfi", served: 1, size: 3, worked_example: false } as const;
    expect(unratedReason(CLEAN, PLAIN_PROMPT, { ...AUTOMATED, rated_eligible: false, automated: block })).toBe(UNRATED_REASONS.seeded);
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

describe("R3.13 PR #45 review round 1, finding 7: the seed sentence only for a seeded automated session", () => {
  it("R3.13 a prediction session and an automated session without its block get the rating-rule sentence, not the seed one", () => {
    expect(unratedReason(CLEAN, PLAIN_PROMPT, { ...AUTOMATED, mode: "prediction", rated_eligible: false, automated: null })).toBe(UNRATED_REASONS.rule);
    expect(unratedReason(CLEAN, PLAIN_PROMPT, { ...AUTOMATED, rated_eligible: false, automated: null })).toBe(UNRATED_REASONS.rule);
  });

  it("R3.13 an automated session with its block and rated_eligible false is the seeded one (session-view.ts: rated_eligible is !seeded)", () => {
    const block = { spot_class_key: "class", track_key: "opens", family: "rfi", served: 1, size: 3, worked_example: false } as const;
    expect(unratedReason(CLEAN, PLAIN_PROMPT, { ...AUTOMATED, rated_eligible: false, automated: block })).toBe(UNRATED_REASONS.seeded);
  });
});
