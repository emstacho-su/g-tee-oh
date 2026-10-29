/**
 * How often the solver takes the chosen action (S46, R3.10, design rule 11, ADR 0004). Pure.
 *
 * The second self-grading number beside the EV lost: the chosen action's share of the hand's
 * strategy, read from the served freq_by_action by the action's position in the node's actions
 * (positional, as the contract defines it, O-198), and the most frequent action for comparison
 * (the largest served share, the first on a tie). Actions are named by exactActionLabel, the
 * summary's own naming. Nothing is computed beyond picking the largest share; a chosen index that
 * names no action, or a share the api did not send, gives null and the caller prints nothing.
 */
import type { DecisionFeedback, NodeAction } from "../../contracts.js";
import { exactActionLabel, formatShare } from "../../poker/format.js";

export interface SolverFrequencyEntry {
  readonly label: string;
  /** A share in 0..1, as served. */
  readonly share: number;
}

export interface SolverFrequency {
  readonly chosen: SolverFrequencyEntry;
  readonly top: SolverFrequencyEntry;
}

type Frequencies = Pick<DecisionFeedback, "freq_by_action">;

/** The position of the largest served share among the actions, or -1 when there is none. */
function topPosition(shares: readonly number[], count: number): number {
  let best = -1;
  for (let position = 0; position < Math.min(shares.length, count); position += 1) {
    const share = shares[position];
    const current = best < 0 ? undefined : shares[best];
    if (share !== undefined && (current === undefined || share > current)) best = position;
  }
  return best;
}

export function solverFrequency(feedback: Frequencies, actions: readonly NodeAction[], chosenIndex: number): SolverFrequency | null {
  const position = actions.findIndex((action) => action.index === chosenIndex);
  const chosenAction = actions[position];
  const share = feedback.freq_by_action[position];
  if (chosenAction === undefined || share === undefined) return null;
  const top = topPosition(feedback.freq_by_action, actions.length);
  const topAction = actions[top];
  const topShare = feedback.freq_by_action[top];
  if (topAction === undefined || topShare === undefined) return null;
  return {
    chosen: { label: exactActionLabel(chosenAction), share },
    top: { label: exactActionLabel(topAction), share: topShare },
  };
}

/** "The solver takes Call 10.0% of the time; its most frequent action is Raise 2.5bb at 80.0%." */
export function solverFrequencyText(feedback: Frequencies, actions: readonly NodeAction[], chosenIndex: number): string | null {
  const frequency = solverFrequency(feedback, actions, chosenIndex);
  if (frequency === null) return null;
  const lead = `The solver takes ${frequency.chosen.label} ${formatShare(frequency.chosen.share)} of the time`;
  if (frequency.top.label === frequency.chosen.label) return `${lead}, its most frequent action.`;
  return `${lead}; its most frequent action is ${frequency.top.label} at ${formatShare(frequency.top.share)}.`;
}

/** The result chip's short form: "Solver 10.0%". */
export function solverFrequencyShort(feedback: Frequencies, actions: readonly NodeAction[], chosenIndex: number): string | null {
  const frequency = solverFrequency(feedback, actions, chosenIndex);
  return frequency === null ? null : `Solver ${formatShare(frequency.chosen.share)}`;
}
