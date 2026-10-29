/**
 * The compact result a reveal shows when it does not pause (S26, S46, R3.13, R3.10, O-314, design
 * rule 11): the grade label in words with its mark and the definitions tip, the loss worded as the
 * summary words it (FeedbackSummary lossText, ADR 0004: the api's numbers, only formatted), and the
 * solver's frequency of the chosen action in short form when the caller names the actions, in
 * place of the full feedback panel while the screen continues by itself. A polite status, so the
 * grade is announced; Next stays available beside it.
 */
import { GradeTip, lossText, solverFrequencyShort } from "../../components/trainer/index.js";
import type { DecisionFeedback, NodeAction } from "../../contracts.js";
import { RESULT_LABELS, SESSION_TEXT } from "./labels.js";

export interface ResultChipProps {
  feedback: DecisionFeedback;
  /** The node's actions and the chosen NodeAction.index, for the solver's frequency (O-198). */
  actions?: readonly NodeAction[];
  chosenIndex?: number;
}

export function ResultChip({ feedback, actions, chosenIndex }: ResultChipProps) {
  const frequency = actions === undefined || chosenIndex === undefined ? null : solverFrequencyShort(feedback, actions, chosenIndex);
  return (
    <p
      role="status"
      data-testid="result-chip"
      data-label={feedback.label}
      className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 self-start rounded-full border border-border bg-surface-raised px-4 py-1.5 text-sm"
    >
      <span className="flex items-center gap-1 font-semibold">
        {RESULT_LABELS[feedback.label]}
        <GradeTip />
      </span>
      <span className="tabular-nums">{lossText(feedback)}</span>
      {frequency === null ? null : <span className="tabular-nums">{frequency}</span>}
      <span className="text-muted">{SESSION_TEXT.continuing}</span>
    </p>
  );
}
