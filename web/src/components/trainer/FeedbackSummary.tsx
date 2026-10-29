/**
 * The feedback panel's summary (S38, S46, R3.8, R3.10, R3.13, O-387, ADR 0024, O-375, design rule
 * 11): what a decision earned, in the few lines that matter, always visible above the collapsed
 * sections.
 *
 * It shows the grade label as text with its chess-style symbol (color is never the only signal)
 * and the grade definitions tip beside it (GradeTip), "Unrated" with the reason the caller names
 * (unrated-reason.ts) when the attempt does not count toward the rating, the roll when there was
 * one, your action, and either "You played the best action" or the best action by name ("Best:
 * Raise 2.5bb", several joined with "or"): best_action_indexes lists only the lowest-loss member
 * or members of each Best group (O-375 as amended), so a worse size of a Best type is labelled
 * Best by its group but the summary names the best size. Then the two self-grading numbers side by
 * side: the loss as the api sends it, in big blinds and percent of the pot ("Lost 0.42bb (3.1% of
 * the pot)", or "No EV lost"), and how often the solver takes your action with its most frequent
 * action (solver-frequency.ts, from the served freq_by_action). ADR 0004: nothing is recomputed.
 * All indexes are NodeAction.index values (O-198); a best index that names no action renders an
 * alert and no Best line, never a wrong action.
 */
import { cn } from "../ui/index.js";
import type { DecisionFeedback, FeedbackLabel, NodeAction } from "../../contracts.js";
import { actionOfIndex, unknownIndexes } from "../../poker/action-index.js";
import { exactActionLabel, formatBb, formatPercent } from "../../poker/format.js";
import { GRADE_NAMES, GradeTip } from "./grade-definitions.js";
import { solverFrequencyText } from "./solver-frequency.js";

interface LabelLook {
  readonly symbol: string;
  readonly className: string;
}

const LABEL_LOOKS: Readonly<Record<FeedbackLabel, LabelLook>> = {
  best: { symbol: "★", className: "text-success" },
  correct: { symbol: "✓", className: "text-success" },
  inaccuracy: { symbol: "?!", className: "text-warning" },
  mistake: { symbol: "?", className: "text-danger" },
  blunder: { symbol: "??", className: "text-danger" },
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
  /** Why the decision is unrated (trainer/unrated-reason.ts); shown only when it is unrated. */
  unratedReason?: string | null;
}

/** The best line: who played best, the best actions by name, or an alert for an unknown index. */
function BestLine({ feedback, actions, chosen }: Pick<FeedbackSummaryProps, "feedback" | "actions" | "chosen">) {
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

/** The loss line, shared with the result chip: "Lost 0.42bb (3.1% of the pot)" or "No EV lost". */
export function lossText(feedback: Pick<DecisionFeedback, "ev_loss_bb" | "ev_loss_pct_pot">): string {
  if (feedback.ev_loss_bb <= 0) return SUMMARY_TEXT.noLoss;
  return `Lost ${formatBb(feedback.ev_loss_bb)} (${formatPercent(feedback.ev_loss_pct_pot)} of the pot)`;
}

export function FeedbackSummary({ feedback, actions, chosen, unratedReason = null }: FeedbackSummaryProps) {
  const look = LABEL_LOOKS[feedback.label];
  const frequency = solverFrequencyText(feedback, actions, chosen.index);
  return (
    <div data-testid="feedback-summary" className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p data-testid="feedback-label" data-label={feedback.label} className={cn("flex items-center gap-1 text-xl font-bold", look.className)}>
          <span aria-hidden="true" className="mr-1 font-mono">
            {look.symbol}
          </span>
          {GRADE_NAMES[feedback.label]}
          <GradeTip className="ml-1" />
        </p>
        {feedback.rated ? null : <span className="rounded-md bg-surface-sunken px-2 text-sm text-muted">{SUMMARY_TEXT.unrated}</span>}
        {feedback.rng_roll === null ? null : <span className="text-sm text-muted tabular-nums">{`Roll ${feedback.rng_roll}`}</span>}
      </div>
      {feedback.rated || unratedReason === null ? null : (
        <p data-testid="unrated-reason" className="text-sm text-muted">
          {unratedReason}
        </p>
      )}
      <p className="text-sm font-medium">{`Your action: ${exactActionLabel(chosen)}`}</p>
      <BestLine feedback={feedback} actions={actions} chosen={chosen} />
      <p className="text-sm tabular-nums">{lossText(feedback)}</p>
      {frequency === null ? null : (
        <p data-testid="solver-frequency" className="text-sm tabular-nums">
          {frequency}
        </p>
      )}
    </div>
  );
}
