/**
 * R3.20 explanation validator vectors (R0.11 red half; the green half is S27 on
 * p3/insights-explanations).
 *
 * Placement: A6 section 1 puts the LLM (large language model) explanation validator in
 * services/api (the validator is pure, the model call is not). The vectors sit here because R0.11
 * collects every learning vector in packages/learning; S27 moves this file beside the validator if
 * it lands in services/api and keeps the test names.
 *
 * Rule (A6 section 5, 05 section 10.2, ADR 0016): extract every number in the response and
 * require each to match a grounding value within rounding, or to be a trivially derived
 * percentage of one grounding value; card and hand names must appear in the grounding. On
 * failure the explanation is regenerated once, then shown with a warning. The grounding below is
 * a toy node with invented numbers; nothing here comes from any reference tool.
 */
import { describe, expect, it } from "vitest";

/** Grounding JSON (JavaScript Object Notation) of one toy preflop decision. */
export const VALIDATOR_GROUNDING = Object.freeze({
  hand: "A5s",
  node: "BTN vs CO 3-bet",
  board: [] as string[],
  frequencies: { fold: 0.12, call: 0.33, raise: 0.55 },
  evBb: { fold: 0, call: 0.41, raise: 0.47 },
  potBb: 7.5,
  thresholds: { weakestRaise: "A2s", strongestFold: "K9o" },
  blockers: ["AA", "AK"],
});

/** A printed number matches a grounding value when it is within half a unit of its own last printed digit. */
export const VALIDATOR_ROUNDING_RULE = "within half a unit of the last printed digit";

export type ValidatorResponseVector = {
  name: string;
  text: string;
  expected: "pass" | "reject";
  /** The token that causes the rejection, when one does. */
  planted?: string;
};

export const VALIDATOR_RESPONSES: readonly ValidatorResponseVector[] = Object.freeze([
  {
    name: "supported numbers pass",
    text: "A5s raises 55% and calls 33%. Raising earns 0.47 bb against 0.41 bb for calling, in a 7.5 bb pot.",
    expected: "pass",
  },
  {
    name: "planted unsupported number is rejected",
    text: "A5s raises 55% of the time, and the raise earns 0.62 bb.",
    expected: "reject",
    planted: "0.62",
  },
  {
    name: "rounded grounding value passes",
    text: "Raising earns about 0.5 bb.",
    expected: "pass",
  },
  {
    name: "trivially derived percentage of one grounding value passes",
    text: "A5s does not raise 45% of the time.",
    expected: "pass",
  },
  {
    name: "unsupported hand name is rejected",
    text: "A5s blocks AA and QQ.",
    expected: "reject",
    planted: "QQ",
  },
  {
    name: "unsupported card at a preflop node with an empty board is rejected",
    text: "On the Kh the raise earns 0.47 bb.",
    expected: "reject",
    planted: "Kh",
  },
  {
    name: "digits inside hand and node names are not numbers",
    text: "A5s facing the 3-bet sits above the K9o fold threshold and the A2s raise threshold.",
    expected: "pass",
  },
]);

describe("R3.20 explanation validator (S27, ADR 0016)", () => {
  it("R0.11 validator vector data parses: every rejected response names its planted token and the grounding frequencies sum to one", () => {
    const frequencies = Object.values(VALIDATOR_GROUNDING.frequencies);
    expect(frequencies.reduce((sum, f) => sum + f, 0)).toBeCloseTo(1, 9);
    expect(VALIDATOR_GROUNDING.board).toHaveLength(0);
    for (const response of VALIDATOR_RESPONSES) {
      if (response.expected === "reject") {
        expect(response.planted).toBeDefined();
        expect(response.text).toContain(response.planted ?? "");
      } else {
        expect(response.planted).toBeUndefined();
      }
    }
    expect(VALIDATOR_RESPONSES.filter((response) => response.expected === "reject")).toHaveLength(3);
  });

  it.todo(
    "R3.20 supported numbers pass: 55%, 33%, 0.47 bb, 0.41 bb and 7.5 bb all appear in the grounding JSON",
  );
  it.todo("R3.20 planted unsupported number is rejected: 0.62 bb matches no grounding value within rounding");
  it.todo("R3.20 rounding: 0.47 printed as 0.5 passes, within half a unit of the last printed digit");
  it.todo("R3.20 trivially derived percentage: 45% is 100 minus the 55% raise frequency and passes");
  it.todo("R3.20 unsupported hand name QQ is rejected while the grounding blockers AA and AK pass");
  it.todo("R3.20 unsupported card Kh is rejected at a preflop node whose grounding board is empty");
  it.todo("R3.20 digits inside hand names and node labels (A5s, 3-bet, K9o, A2s) are not extracted as numbers");
  it.todo("R3.20 the validator is pure: the same response and grounding give the same verdict and it mutates neither");
  it.todo(
    "R3.20 one regeneration on failure, then the explanation is shown with a warning (services/api orchestration, S27)",
  );
});
