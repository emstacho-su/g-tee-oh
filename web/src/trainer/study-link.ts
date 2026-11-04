/**
 * Study this spot (S46, R3.34, item 11): the study link for a graded decision. Pure.
 *
 * Mechanism: the feedback names the decision's configuration, pair and hand; the configuration
 * list (settings/configs-query.ts) gives the configuration's format, table size, stake and depth,
 * the study screen's five settings. The node is reached by its line, never by its key: the line is
 * the pair's own preflop tokens from the prompt's history, in order, which share solver-query's
 * token vocabulary with the study line (services/api/src/study/line-walk.ts). The other seats only
 * fold in a pair's tree, so a seat outside the pair that did anything else, or a postflop node,
 * falls back to the pair's root (no line). Every value goes through validateStudySearch, so the
 * link carries only what the study screen accepts, and it is written with the router's own
 * query-string rule (app/search-serialization.ts), so a hand such as 55 stays a string.
 * The node key stays opaque: it is never parsed (ADR 0018).
 */
import { stringifySearchAsStrings } from "../app/search-serialization.js";
import type { DecisionFeedback, TrainerPrompt } from "../contracts.js";
import type { GameConfig } from "../progress/types.js";
import { heroHandClass } from "../poker/hand-class.js";
import { validateStudySearch, type StudySearch } from "../study/search.js";

/** The study screen's path; the link opens it in a new tab. */
export const STUDY_PATH = "/study";
/** The only street a study line reaches (v1 serves preflop spots). */
const STUDY_STREET = "preflop";
/** The token of a fold, the one action a seat outside the pair takes in the pair's tree. */
const FOLD_TOKEN = "f";
const PAIR_SEPARATOR = "-";
const LINE_SEPARATOR = ".";

type History = TrainerPrompt["history"];

/** The pair's line from the history, or undefined for the pair's root (no line, or one it cannot read). */
export function studyLineOf(history: History, pair: string, street: TrainerPrompt["street"]): string | undefined {
  if (street !== STUDY_STREET) return undefined;
  const seats = new Set(pair.split(PAIR_SEPARATOR));
  const tokens: string[] = [];
  for (const entry of history) {
    if ((entry.street ?? STUDY_STREET) !== STUDY_STREET) return undefined;
    if (seats.has(entry.position)) tokens.push(entry.token);
    else if (entry.token !== FOLD_TOKEN) return undefined;
  }
  return tokens.length === 0 ? undefined : tokens.join(LINE_SEPARATOR);
}

type FeedbackFacts = Pick<DecisionFeedback, "config_id" | "pair" | "hand">;
type PromptFacts = Pick<TrainerPrompt, "history" | "street">;

/** The study search for a graded decision, or null when the configuration list does not hold it. */
export function studySearchFor(feedback: FeedbackFacts, prompt: PromptFacts, configs: readonly GameConfig[]): StudySearch | null {
  const config = configs.find((entry) => entry.config_id === feedback.config_id);
  if (config === undefined) return null;
  return validateStudySearch({
    format: config.format,
    table_size: config.table_size,
    stake: config.stake_id,
    depth: config.depth_cbb,
    pair: feedback.pair,
    line: studyLineOf(prompt.history, feedback.pair, prompt.street),
    hand: heroHandClass(feedback.hand) ?? undefined,
  });
}

/** The link to the study screen for a search. */
export function studyHrefFor(search: StudySearch): string {
  return `${STUDY_PATH}${stringifySearchAsStrings({ ...search })}`;
}

/** The study link for a graded decision, or null when the configuration list does not hold it. */
export function studyLinkFor(feedback: FeedbackFacts, prompt: PromptFacts, configs: readonly GameConfig[]): string | null {
  const search = studySearchFor(feedback, prompt, configs);
  return search === null ? null : studyHrefFor(search);
}
