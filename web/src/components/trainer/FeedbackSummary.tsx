/**
 * The feedback panel's summary (S38, R3.13, O-387, ADR 0024, O-375): what a decision earned, in
 * the few lines that matter, always visible above the collapsed sections.
 *
 * It shows the grade label as text with its chess-style symbol (color is never the only signal),
 * "Unrated" when the attempt does not count toward the rating, the roll when there was one, your
 * action, and either "You played the best action" or the best action by name ("Best: Raise
 * 2.5bb", several joined with "or"): best_action_indexes lists only the lowest-loss member or
 * members of each Best group (O-375 as amended), so a worse size of a Best type is labelled Best
 * by its group but the summary names the best size. Then the loss as the api sends it, in big
 * blinds and percent of the pot ("Lost 0.42bb (3.1% of the pot)"), or "No EV lost" (ADR 0004:
 * nothing is recomputed). All indexes are NodeAction.index values (O-198); a best index that names
 * no action renders an alert and no Best line, never a wrong action.
 */
import { cn } from "../ui/index.js";
import type { DecisionFeedback, FeedbackLabel, NodeAction } from "../../contracts.js";
import { actionOfIndex, unknownIndexes } from "../../poker/action-index.js";
import { exactActionLabel, formatBb, formatPercent } from "../../poker/format.js";

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

export const SUMMARY_TEXT = {
  unrated: "Unrated",
  playedBest: "You played the best action",
  noLoss: "No EV lost",
} as const;

export interface FeedbackSummaryProps {
  feedback: DecisionFeedback;
  actions: readonly NodeAction[];
  /** The chosen action, already resolved from its NodeAction.index by the panel. */
  chosen: NodeAction;
}

/** The best line: who played best, the best actions by name, or an alert for an unknown index. */
function BestLine({ feedback, actions, chosen }: FeedbackSummaryProps) {
  const [unknown] = unknownIndexes(actions, feedback.best_action_indexes);
  if (unknown !== undefined) {
    return (
      <p role="alert" className="text-sm text-danger">
        {`Best action ${unknown} is not one of the ${actions.length} actions.`}
      </p>
    );
  }
  if (feedback.best_action_indexes.includes(chosen.index)) return <p className="text-sm">{SUMMARY_TEXT.playedBest}</p>;
  const best = feedback.best_action_indexes.flatMap((index) => {
    const action = actionOfIndex(actions, index);
    return action === undefined ? [] : [exactActionLabel(action)];
  });
  return best.length === 0 ? null : <p className="text-sm">{`Best: ${best.join(" or ")}`}</p>;
}

function lossText(feedback: DecisionFeedback): string {
  if (feedback.ev_loss_bb <= 0) return SUMMARY_TEXT.noLoss;
  return `Lost ${formatBb(feedback.ev_loss_bb)} (${formatPercent(feedback.ev_loss_pct_pot)} of the pot)`;
}

export function FeedbackSummary({ feedback, actions, chosen }: FeedbackSummaryProps) {
  const look = LABEL_LOOKS[feedback.label];
  return (
    <div data-testid="feedback-summary" className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p data-testid="feedback-label" data-label={feedback.label} className={cn("text-xl font-bold", look.className)}>
          <span aria-hidden="true" className="mr-1 font-mono">
            {look.symbol}
          </span>
          {look.text}
        </p>
        {feedback.rated ? null : <span className="rounded-md bg-surface-sunken px-2 text-sm text-muted">{SUMMARY_TEXT.unrated}</span>}
        {feedback.rng_roll === null ? null : <span className="text-sm text-muted tabular-nums">{`Roll ${feedback.rng_roll}`}</span>}
      </div>
      <p className="text-sm font-medium">{`Your action: ${exactActionLabel(chosen)}`}</p>
      <BestLine feedback={feedback} actions={actions} chosen={chosen} />
      <p className="text-sm tabular-nums">{lossText(feedback)}</p>
    </div>
  );
}
