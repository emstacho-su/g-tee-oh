/**
 * How often the solver takes the chosen action (S46, R3.10, design rule 11, ADR 0004): read from
 * the served freq_by_action by the chosen action's position, named like the summary's own action
 * line, with the most frequent action beside it. Nothing is computed beyond picking the largest
 * served share.
 */
import { describe, expect, it } from "vitest";

import { solverFrequency, solverFrequencyShort, solverFrequencyText } from "../../src/components/trainer/solver-frequency.js";
import type { DecisionFeedback } from "../../src/contracts.js";
import { fixtureActions, fixtureFeedback } from "../../src/fixtures/index.js";

const CALL_INDEX = 1;
const RAISE_INDEX = 2;

describe("R3.10 solver frequency of the chosen action", () => {
  it("R3.10 reads the chosen action's share by its position and names the most frequent action", () => {
    // fixtureFeedback.freq_by_action is [0.05, 0.1, 0.8, 0.05]: Call 10%, Raise 80%.
    expect(solverFrequency(fixtureFeedback, fixtureActions, CALL_INDEX)).toEqual({
      chosen: { label: "Call", share: 0.1 },
      top: { label: "Raise 2.5bb", share: 0.8 },
    });
    expect(solverFrequencyText(fixtureFeedback, fixtureActions, CALL_INDEX)).toBe(
      "The solver takes Call 10.0% of the time; its most frequent action is Raise 2.5bb at 80.0%.",
    );
    expect(solverFrequencyShort(fixtureFeedback, fixtureActions, CALL_INDEX)).toBe("Solver 10.0%");
  });

  it("R3.10 says so when the chosen action is the most frequent one", () => {
    expect(solverFrequencyText(fixtureFeedback, fixtureActions, RAISE_INDEX)).toBe(
      "The solver takes Raise 2.5bb 80.0% of the time, its most frequent action.",
    );
  });

  it("R3.10 shares print at one decimal, the panel's one precision for a frequency (critic round 3 G6)", () => {
    const feedback: DecisionFeedback = { ...fixtureFeedback, freq_by_action: [0.4567, 0.5433, 0, 0] };
    expect(solverFrequencyText(feedback, fixtureActions, 0)).toContain("45.7%");
    expect(solverFrequencyText(feedback, fixtureActions, 0)).toContain("54.3%");
  });

  it("R3.10 the first of two tied top shares is the most frequent action", () => {
    const feedback: DecisionFeedback = { ...fixtureFeedback, freq_by_action: [0.5, 0.5, 0, 0] };
    expect(solverFrequency(feedback, fixtureActions, CALL_INDEX)?.top).toEqual({ label: "Fold", share: 0.5 });
  });

  it("R3.10 a chosen index that names no action, or a share the api did not send, gives nothing", () => {
    expect(solverFrequency(fixtureFeedback, fixtureActions, 99)).toBeNull();
    const short: DecisionFeedback = { ...fixtureFeedback, freq_by_action: [0.5] };
    expect(solverFrequency(short, fixtureActions, RAISE_INDEX)).toBeNull();
    expect(solverFrequencyText(short, fixtureActions, RAISE_INDEX)).toBeNull();
    expect(solverFrequencyShort(short, fixtureActions, RAISE_INDEX)).toBeNull();
  });
});
