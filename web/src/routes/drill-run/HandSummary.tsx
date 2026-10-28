/**
 * How the last hand ended, shown at the first decision of the next hand in street and full-hand
 * modes (S26, R3.13, O-313). The strip names the hand by its ordinal on this page, says why it
 * ended, one wording per previous_hand.end as the api recorded it (PR #30 review MEDIUM 5: "Ended
 * at the flop", "Ended with a fold", "Ended when the street closed"),
 * lists the closing actions (the hero's last action and what followed it) and, when the hand
 * reached a board (full-hand mode reveals the flop in v1), shows those cards with CardView, whose
 * accessible names carry the suits.
 */
import { useId } from "react";

import { CardView } from "../../components/table/index.js";
import { summarizeHand, type EndedHand } from "../../trainer/hand-progress.js";
import { SESSION_TEXT } from "./labels.js";

export interface HandSummaryProps {
  ended: EndedHand;
}

export function HandSummary({ ended }: HandSummaryProps) {
  const closingId = useId();
  const summary = summarizeHand(ended);
  return (
    <section
      aria-label={`How ${summary.title.toLowerCase()} ended`}
      data-testid="hand-summary"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm"
    >
      <p>
        <span className="font-semibold">{summary.title}</span>
        {`: ${summary.endText}`}
      </p>
      {summary.closing.length === 0 ? null : (
        <div className="flex items-center gap-2">
          <span id={closingId} className="text-muted">
            {SESSION_TEXT.closingActions}
          </span>
          <ul aria-labelledby={closingId} className="flex flex-wrap gap-x-2">
            {summary.closing.map((action, step) => (
              <li key={`${step}-${action}`}>{action}</li>
            ))}
          </ul>
        </div>
      )}
      {summary.flop.length === 0 ? null : (
        // Named after the hand, so it differs from the table's own (empty) Flop group.
        <div role="group" aria-label={`${summary.title} ${SESSION_TEXT.flop.toLowerCase()}`} className="flex items-center gap-1">
          <span aria-hidden="true" className="mr-1 text-muted">
            {SESSION_TEXT.flop}
          </span>
          {summary.flop.map((card) => (
            <CardView key={card} card={card} size="sm" />
          ))}
        </div>
      )}
    </section>
  );
}
