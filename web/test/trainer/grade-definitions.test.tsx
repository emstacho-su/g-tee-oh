/**
 * The five grade labels defined where their counts appear (S46, R3.8, R3.13, design rule 11,
 * ADR 0024): one plain sentence per label whose thresholds are learning's own constants, the roll
 * note, and the GradeTip that carries them beside a label or a count.
 */
import { BLUNDER_ABOVE_PCT_POT, MISTAKE_FROM_PCT_POT } from "@g-tee-oh/learning";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GRADE_DEFINITIONS, GRADE_ROLL_NOTE, GRADE_TIP_SUBJECT, GradeTip } from "../../src/components/trainer/grade-definitions.js";
import { GRADE_DEFINITIONS as LABELS_DEFINITIONS } from "../../src/routes/drill-run/labels.js";

const LABELS = ["best", "correct", "inaccuracy", "mistake", "blunder"] as const;

describe("R3.8 grade definitions", () => {
  it("R3.8 defines every label once, in words, and the drill run labels read the same map", () => {
    expect(Object.keys(GRADE_DEFINITIONS).sort()).toEqual([...LABELS].sort());
    expect(LABELS_DEFINITIONS).toBe(GRADE_DEFINITIONS);
    for (const label of LABELS) expect(GRADE_DEFINITIONS[label].length).toBeGreaterThan(20);
  });

  it("R3.8 Best is the highest-EV group at or below the floor and Correct any other at or below it (ADR 0024)", () => {
    expect(GRADE_DEFINITIONS.best).toMatch(/highest-EV/);
    expect(GRADE_DEFINITIONS.best).toMatch(/floor/);
    expect(GRADE_DEFINITIONS.correct).toMatch(/floor/);
    expect(GRADE_DEFINITIONS.correct).not.toMatch(/highest/);
  });

  it("R3.8 the loss bands quote learning's thresholds, never retyped numbers", () => {
    expect(GRADE_DEFINITIONS.inaccuracy).toContain(`${MISTAKE_FROM_PCT_POT}%`);
    expect(GRADE_DEFINITIONS.mistake).toContain(`${MISTAKE_FROM_PCT_POT}%`);
    expect(GRADE_DEFINITIONS.mistake).toContain(`${BLUNDER_ABOVE_PCT_POT}%`);
    expect(GRADE_DEFINITIONS.blunder).toContain(`${BLUNDER_ABOVE_PCT_POT}%`);
    expect(GRADE_DEFINITIONS.inaccuracy).toMatch(/floor/);
  });

  it("R3.10 the roll never changes the label (ADR 0024 rule 2)", () => {
    expect(GRADE_ROLL_NOTE).toMatch(/never changes the label/);
  });

  it("R3.13 GradeTip is an info button about grade labels whose text names every label and the roll note", () => {
    render(<GradeTip />);
    const button = screen.getByRole("button", { name: `About ${GRADE_TIP_SUBJECT}` });
    expect(button).toHaveAttribute("aria-describedby");
    const text = document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent ?? "";
    for (const label of LABELS) expect(text).toContain(GRADE_DEFINITIONS[label]);
    expect(text).toContain(GRADE_ROLL_NOTE);
    expect(text).toMatch(/Best/);
    expect(text).toMatch(/Blunder/);
  });
});
