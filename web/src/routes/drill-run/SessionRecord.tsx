/**
 * The session's record around the decision area (S46, R3.32): the tally above the table and the
 * "This session" history under it, both from the session hook's decision log, shared by the drill
 * run and /train. Shown from the first prompt; the run tile follows the prompt's panels.
 */
import { showsRun, tallyOf, type SessionLog } from "../../trainer/session-log.js";
import type { TrainerPrompt } from "../../contracts.js";
import { historySlotsFor } from "./feedback-slots.js";
import { SessionHistory } from "./SessionHistory.js";
import { SessionTally } from "./SessionTally.js";

export interface SessionTallyRowProps {
  log: SessionLog;
  /** The prompt on screen, or null between prompts; the last decision's prompt stands in then. */
  prompt: TrainerPrompt | null;
}

export function SessionTallyRow({ log, prompt }: SessionTallyRowProps) {
  const shownPrompt = prompt ?? log.entries.at(-1)?.prompt ?? null;
  return <SessionTally tally={tallyOf(log.entries)} showRun={showsRun(shownPrompt)} />;
}

export interface SessionHistoryListProps {
  log: SessionLog;
  /** Street and full-hand modes name the decision within the hand. */
  decisions: boolean;
  onExplain: () => void;
}

export function SessionHistoryList({ log, decisions, onExplain }: SessionHistoryListProps) {
  return <SessionHistory entries={log.entries} decisions={decisions} slotsFor={historySlotsFor(onExplain)} />;
}
