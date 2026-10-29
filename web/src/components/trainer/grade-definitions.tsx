/**
 * The five grade labels defined in words, and the tip that carries them (S46, R3.8, R3.13, design
 * rule 11, ADR 0024, O-343, O-370). One sentence per label wherever a label or a count appears,
 * so the vocabulary is the same from the result chip to the session totals.
 *
 * The thresholds are learning's own constants (packages/learning/src/grading.ts labelFor):
 * at or below the solver's floor the decision is Best when its group has the lowest loss at the
 * node (ties within the tolerance all Best) and Correct otherwise; above the floor the raw loss
 * in percent of the pot alone decides Inaccuracy (under MISTAKE_FROM_PCT_POT), Mistake (up to
 * BLUNDER_ABOVE_PCT_POT inclusive) or Blunder. The words follow the code: the bands are read on
 * the loss itself, not on the loss above the floor. The roll never changes the label (rule 2).
 */
import { BLUNDER_ABOVE_PCT_POT, MISTAKE_FROM_PCT_POT } from "@g-tee-oh/learning";

import { InfoTip } from "../ui/index.js";
import type { FeedbackLabel } from "../../contracts.js";

/** The label names, as the summary and the chips print them. */
export const GRADE_NAMES: Readonly<Record<FeedbackLabel, string>> = {
  best: "Best",
  correct: "Correct",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
};

/** The order the definitions are listed in, best to worst. */
export const GRADE_ORDER: readonly FeedbackLabel[] = ["best", "correct", "inaccuracy", "mistake", "blunder"];

export const GRADE_DEFINITIONS: Readonly<Record<FeedbackLabel, string>> = {
  best: "The highest-EV action group at or below the solver's floor; groups tied for the lowest loss are all Best.",
  correct: "Any other action at or below the solver's floor.",
  inaccuracy: `Above the floor, with under ${MISTAKE_FROM_PCT_POT}% of the pot lost.`,
  mistake: `${MISTAKE_FROM_PCT_POT}% to ${BLUNDER_ABOVE_PCT_POT}% of the pot lost.`,
  blunder: `More than ${BLUNDER_ABOVE_PCT_POT}% of the pot lost.`,
};

export const GRADE_ROLL_NOTE = "The roll of Mixed-frequency mode never changes the label.";

export const GRADE_TIP_SUBJECT = "grade labels";

export interface GradeTipProps {
  className?: string;
}

/** The info button that explains the five labels and the roll, placed beside a label or a count. */
export function GradeTip({ className }: GradeTipProps) {
  return (
    <InfoTip subject={GRADE_TIP_SUBJECT} {...(className === undefined ? {} : { className })}>
      {/* A definition list, so the hidden text reads "Best The highest..." and never a "Best:" line of its own. */}
      <dl className="flex flex-col gap-1">
        {GRADE_ORDER.map((label) => (
          <div key={label} className="flex gap-1">
            <dt className="shrink-0 font-semibold">{GRADE_NAMES[label]}</dt>
            <dd>{GRADE_DEFINITIONS[label]}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1">{GRADE_ROLL_NOTE}</p>
    </InfoTip>
  );
}
