/**
 * The feedback panel shown after a decision (S24, 05, A7, R3.13). A shell: S25 wires it to the
 * session and S27 fills More info and Ask.
 *
 * It shows the grade label as text with a symbol (chess-style marks, so color is never the only
 * signal), the EV (expected value) loss in big blinds and in percent of the pot as the api sends
 * them (ADR 0004: nothing is recomputed), the action the hero chose, the hand's frequency and EV
 * per action through ActionFrequencyTable with the best actions marked "Best" in text, the RNG
 * roll when there was one, and "Unrated" when the attempt does not count toward the rating. Two
 * slots take the range view and the threshold card. More info and Ask render disabled with a
 * note when their handlers are absent.
 */
import type { ReactNode } from "react";

import { Button, cn } from "../ui/index.js";
import type { DecisionFeedback, FeedbackLabel, NodeAction } from "../../contracts.js";
import { exactActionLabel, formatBb, formatPercent } from "../../poker/format.js";
import { ActionFrequencyTable } from "../panels/ActionFrequencyTable.js";

export interface FeedbackPanelProps {
  feedback: DecisionFeedback;
  actions: readonly NodeAction[];
  chosenIndex: number;
  rangeView?: ReactNode;
  thresholdCard?: ReactNode;
  onMoreInfo?: () => void;
  onAsk?: () => void;
}

interface LabelLook {
  readonly text: string;
  readonly symbol: string;
  readonly className: string;
}

const LABEL_LOOKS: Readonly<Record<FeedbackLabel, LabelLook>> = {
  best: { text: "Best", symbol: "★", className: "text-success" },
  correct: { text: "Correct", symbol: "✓", className: "text-success" },
  inaccuracy: { text: "Inaccuracy", symbol: "?!", className: "text-warning" },
  mistake: { text: "Mistake", symbol: "?", className: "text-danger" },
  blunder: { text: "Blunder", symbol: "??", className: "text-danger" },
};

export const LATER_SESSION_NOTE = "Arrives in S27";

function LaterButton({ label, onClick }: { label: string; onClick: (() => void) | undefined }) {
  if (onClick === undefined) {
    return (
      <Button disabled title={`${label}: ${LATER_SESSION_NOTE}`}>
        {label}
      </Button>
    );
  }
  return <Button onClick={onClick}>{label}</Button>;
}

export function FeedbackPanel({ feedback, actions, chosenIndex, rangeView, thresholdCard, onMoreInfo, onAsk }: FeedbackPanelProps) {
  const chosen = actions.find((action) => action.index === chosenIndex);
  if (chosen === undefined) {
    return (
      <p role="alert" data-testid="feedback-panel" className="text-danger">
        {`The chosen action ${chosenIndex} is not one of this node's ${actions.length} actions.`}
      </p>
    );
  }
  const look = LABEL_LOOKS[feedback.label];
  return (
    <section data-testid="feedback-panel" aria-label="Decision feedback" className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <p data-testid="feedback-label" data-label={feedback.label} className={cn("text-xl font-bold", look.className)}>
          <span aria-hidden="true" className="mr-1 font-mono">
            {look.symbol}
          </span>
          {look.text}
        </p>
        {feedback.rated ? null : <span className="rounded bg-surface-sunken px-2 text-sm text-muted">Unrated</span>}
        {feedback.rng_roll === null ? null : <span className="text-sm tabular-nums">Roll {feedback.rng_roll}</span>}
      </div>
      <p className="tabular-nums">
        {`EV loss ${formatBb(feedback.ev_loss_bb)} (${formatPercent(feedback.ev_loss_pct_pot)} of pot)`}
      </p>
      <p>{`Your action: ${exactActionLabel(chosen)}`}</p>
      <ActionFrequencyTable
        actions={actions}
        frequencies={feedback.freq_by_action}
        evBb={feedback.ev_by_action}
        highlightIndexes={feedback.best_action_indexes}
        caption="This hand's strategy"
      />
      {rangeView}
      {thresholdCard}
      <div className="flex gap-2">
        <LaterButton label="More info" onClick={onMoreInfo} />
        <LaterButton label="Ask" onClick={onAsk} />
      </div>
    </section>
  );
}
