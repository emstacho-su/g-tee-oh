/**
 * The compact result a reveal shows when it does not pause (S26, R3.13, O-314): the grade label in
 * words with its mark and the EV loss in big blinds as the api sends it (ADR 0004), in place of
 * the full feedback panel while the screen continues by itself. A polite status, so the grade is
 * announced; Next stays available beside it.
 */
import type { DecisionFeedback } from "../../contracts.js";
import { formatBb } from "../../poker/format.js";
import { RESULT_LABELS, SESSION_TEXT } from "./labels.js";

export interface ResultChipProps {
  feedback: DecisionFeedback;
}

export function ResultChip({ feedback }: ResultChipProps) {
  return (
    <p
      role="status"
      data-testid="result-chip"
      data-label={feedback.label}
      className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 self-start rounded-full border border-border bg-surface-raised px-4 py-1.5 text-sm"
    >
      <span className="font-semibold">{RESULT_LABELS[feedback.label]}</span>
      <span className="tabular-nums">{`EV loss ${formatBb(feedback.ev_loss_bb)}`}</span>
      <span className="text-muted">{SESSION_TEXT.continuing}</span>
    </p>
  );
}
