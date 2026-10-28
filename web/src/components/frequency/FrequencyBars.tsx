/**
 * The visual half of the frequency card (S41, R4.12, O-347, O-353, O-367): for one spot, paired
 * bars per action (yours, then the solver's) with the share written next to each bar and the words
 * You and Solver, so colour is never the only signal; then the hand rows, each with its decisions
 * and every action's two shares, in the api's order (the largest gap first). The whole visual is
 * aria-hidden: FrequencyTable carries the same numbers for screen readers.
 */
import type { FrequencyRow, HandFrequency, SpotFrequency } from "../../progress/frequency-model.js";
import { percentText } from "../../progress/frequency-model.js";

const PERCENT_SCALE = 100;
const BAR_TRACK_CLASS = "h-2.5 flex-1 overflow-hidden rounded-full bg-surface-sunken";

interface BarProps {
  who: string;
  share: number;
  fillClass: string;
}

function Bar({ who, share, fillClass }: BarProps) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 tabular-nums">
        {who} {percentText(share)}
      </span>
      <span className={BAR_TRACK_CLASS}>
        <span className={`block h-full rounded-full ${fillClass}`} style={{ width: `${Math.round(share * PERCENT_SCALE)}%` }} />
      </span>
    </div>
  );
}

function shareAt(row: FrequencyRow, index: number): { yours: number; solver: number } {
  return { yours: row.your_freq[index] ?? 0, solver: row.solver_freq[index] ?? 0 };
}

function HandRow({ hand, actions }: { hand: HandFrequency; actions: SpotFrequency["actions"] }) {
  return (
    <li data-testid="frequency-hand-row" className="flex flex-col gap-1 border-t border-border/50 pt-2 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="flex w-36 shrink-0 items-baseline gap-2">
        <span data-testid="frequency-hand" className="font-mono font-semibold">
          {hand.hand_class}
        </span>
        <span className="text-xs text-muted">{hand.decisions} decisions</span>
      </span>
      <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {actions.map((action, position) => {
          const { yours, solver } = shareAt(hand, position);
          return (
            <span key={action.index} className="tabular-nums">
              {action.label}: you {percentText(yours)}, solver {percentText(solver)}
            </span>
          );
        })}
      </span>
    </li>
  );
}

export interface FrequencyBarsProps {
  spot: SpotFrequency;
  pooled: FrequencyRow;
}

export function FrequencyBars({ spot, pooled }: FrequencyBarsProps) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div data-testid="frequency-bars" aria-hidden="true" className="flex flex-col gap-3">
        {spot.actions.map((action, position) => {
          const { yours, solver } = shareAt(pooled, position);
          return (
            <div key={action.index} data-testid="frequency-action" className="flex flex-col gap-1">
              <span className="text-sm font-medium">{action.label}</span>
              <Bar who="You" share={yours} fillClass="bg-accent" />
              <Bar who="Solver" share={solver} fillClass="bg-border-strong" />
            </div>
          );
        })}
      </div>
      {spot.hands.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {spot.hands.map((hand) => (
            <HandRow key={hand.hand_class} hand={hand} actions={spot.actions} />
          ))}
        </ul>
      )}
    </div>
  );
}
