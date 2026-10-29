/**
 * The in-session decision log and its tally (S46, R3.32, design rule 10, O-477, ADR 0004). Pure:
 * no input/output, no clock and no randomness.
 *
 * Mechanism: the session hook folds every machine state into the log with logAfter. A reveal
 * (the feedback state) appends one entry, keyed by the decision's Idempotency-Key, so the same
 * reveal seen again (a re-render, a pause) is never counted twice; this is what keeps a decision
 * whose reveal continued by itself (pause rule Never) on record. Starting a session or going back
 * to the start panel clears the log; every other state keeps it, the recap included, so the recap
 * reads the same numbers the tally showed.
 *
 * tallyOf aggregates only what the api served per decision: the count per grade label, the rated
 * count, the EV loss in big blinds summed and averaged over the decisions, and the run of Best or
 * Correct decisions since the last other label. Nothing is derived from frequencies. The run is
 * shown only when the prompt names the streak_counter panel key (its wire name, O-377), and is
 * called a run, never a streak, which is the daily practice streak (O-278).
 */
import type { DecisionFeedback, FeedbackLabel, PanelKey, TrainerPrompt } from "../contracts.js";
import type { HandProgress } from "./hand-progress.js";
import type { PracticeSession } from "./session-types.js";
import type { SpotState } from "./spot-machine.js";

/** One graded decision, as the reveal showed it. */
export interface DecisionEntry {
  /** The decision's Idempotency-Key: one entry per decision. */
  readonly key: string;
  readonly hand: HandProgress;
  readonly prompt: TrainerPrompt;
  /** The NodeAction.index the hero chose (O-198). */
  readonly actionIndex: number;
  readonly feedback: DecisionFeedback;
  /** The session the decision was graded in, for its unrated reason. */
  readonly session: PracticeSession;
}

export interface SessionLog {
  readonly entries: readonly DecisionEntry[];
}

export const EMPTY_LOG: SessionLog = Object.freeze({ entries: Object.freeze([]) as readonly DecisionEntry[] });

/** The states that start a session afresh: the log clears. */
const CLEARING: ReadonlySet<SpotState["kind"]> = new Set(["idle", "starting"]);

/** The log after a machine state; the same log object when nothing changed. */
export function logAfter(log: SessionLog, state: SpotState): SessionLog {
  if (CLEARING.has(state.kind)) return log.entries.length === 0 ? log : EMPTY_LOG;
  if (state.kind !== "feedback") return log;
  const key = state.decision.idempotencyKey;
  if (log.entries.some((entry) => entry.key === key)) return log;
  const hand = state.context.hand;
  if (hand === undefined) return log;
  const entry: DecisionEntry = {
    key,
    hand,
    prompt: state.prompt,
    actionIndex: state.decision.actionIndex,
    feedback: state.feedback,
    session: state.context.session,
  };
  return { entries: [...log.entries, entry] };
}

export type LabelCounts = Readonly<Record<FeedbackLabel, number>>;

export interface SessionTally {
  readonly decisions: number;
  readonly counts: LabelCounts;
  readonly rated: number;
  /** The served EV loss summed over the decisions, in big blinds. */
  readonly evLossTotalBb: number;
  /** The mean EV loss per decision in big blinds, or null before the first decision. */
  readonly evLossMeanBb: number | null;
  /** Best or Correct decisions since the last other label. */
  readonly run: number;
}

const ZERO_COUNTS: LabelCounts = { best: 0, correct: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
const RUN_LABELS: ReadonlySet<FeedbackLabel> = new Set<FeedbackLabel>(["best", "correct"]);

/** The panel key that shows the run (its wire name stays streak_counter, O-377). */
export const RUN_PANEL_KEY: PanelKey = "streak_counter";

/** Best or Correct decisions at the end of the log, back to the last other label. */
export function runOf(entries: readonly DecisionEntry[]): number {
  let run = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === undefined || !RUN_LABELS.has(entry.feedback.label)) break;
    run += 1;
  }
  return run;
}

export function tallyOf(entries: readonly DecisionEntry[]): SessionTally {
  const counts = entries.reduce<LabelCounts>((current, entry) => ({ ...current, [entry.feedback.label]: current[entry.feedback.label] + 1 }), ZERO_COUNTS);
  const evLossTotalBb = entries.reduce((sum, entry) => sum + entry.feedback.ev_loss_bb, 0);
  return {
    decisions: entries.length,
    counts,
    rated: entries.filter((entry) => entry.feedback.rated).length,
    evLossTotalBb,
    evLossMeanBb: entries.length === 0 ? null : evLossTotalBb / entries.length,
    run: runOf(entries),
  };
}

/** Whether the session's prompt turns the run tile on. */
export function showsRun(prompt: Pick<TrainerPrompt, "visible_panels"> | null): boolean {
  return prompt !== null && prompt.visible_panels.includes(RUN_PANEL_KEY);
}
