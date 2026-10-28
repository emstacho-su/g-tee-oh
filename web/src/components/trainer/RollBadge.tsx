/**
 * The roll shown before a decision in RNG (random number generator) mode (S25, R3.10, O-282).
 *
 * Mechanism: the trainer prompt carries the roll (TrainerPrompt.rng_roll) but no strategy, by
 * design (predict before peek, 05 section 5). The badge therefore shows the number only ("Roll
 * 37") and an info button that opens the explainer; it never draws a band, because the bands are
 * the hand's strategy and would give the answer away. FeedbackRoller draws them after the reveal.
 */
import { Button } from "../ui/index.js";
import { RNG_EXPLAINER_TITLE } from "./use-rng-explainer.js";

export interface RollBadgeProps {
  roll: number;
  onExplain: () => void;
}

export function RollBadge({ roll, onExplain }: RollBadgeProps) {
  return (
    <div data-testid="roll-badge" className="inline-flex items-center gap-1 rounded border border-border bg-surface-sunken px-2 py-1">
      <span className="text-sm font-medium tabular-nums">{`Roll ${roll}`}</span>
      <Button variant="ghost" size="sm" aria-label={RNG_EXPLAINER_TITLE} onClick={onExplain}>
        <span aria-hidden="true">ⓘ</span>
      </Button>
    </div>
  );
}
