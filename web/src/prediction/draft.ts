/**
 * The answer being composed for a prediction prompt (S27 lane A, R3.16, O-301): one draft per
 * answer kind, and the conversion to the contract's answer once it is complete. Pure and
 * immutable: every change returns a new draft. A regions draft is always complete, since "no
 * region mixes" is a valid answer; the percent draft keeps the typed text and becomes an answer
 * only when it reads as a number from 0 to 100. Since S41 every answer carries a typed reason of 3
 * to 1,000 characters after trimming (O-412); reasonReady is the client's half of that rule.
 */
import type { NodeAction, PredictionPrompt } from "../contracts.js";
import type { FrequencyBand, HandRegion, PredictionAnswer, PredictionKind } from "./types.js";

export const PERCENT_MIN = 0;
export const PERCENT_MAX = 100;
export const PERCENT_STEP = 5;
const AGGRESSIVE_KINDS: ReadonlySet<NodeAction["kind"]> = new Set(["bet", "raise", "all_in"]);

export type AnswerDraft =
  | { kind: "yes_no"; value: boolean | null }
  | { kind: "percent"; text: string }
  | { kind: "regions"; value: readonly HandRegion[] }
  | { kind: "action"; actionIndex: number | null }
  | { kind: "size"; actionIndex: number | null }
  | { kind: "band"; band: FrequencyBand | null };

export function emptyDraft(kind: PredictionKind): AnswerDraft {
  switch (kind) {
    case "yes_no":
      return { kind, value: null };
    case "percent":
      return { kind, text: "" };
    case "regions":
      return { kind, value: [] };
    case "action":
    case "size":
      return { kind, actionIndex: null };
    case "band":
      return { kind, band: null };
  }
}

/** The regions draft with one region added or removed, in the prompt's offered order. */
export function toggleRegion(draft: Extract<AnswerDraft, { kind: "regions" }>, region: HandRegion, offered: readonly HandRegion[]): AnswerDraft {
  const picked = new Set(draft.value.includes(region) ? draft.value.filter((entry) => entry !== region) : [...draft.value, region]);
  return { kind: "regions", value: offered.filter((entry) => picked.has(entry)) };
}

function percentOf(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= PERCENT_MIN && value <= PERCENT_MAX ? value : null;
}

/** The contract answer of a complete draft; null while it is incomplete. */
export function toAnswer(draft: AnswerDraft): PredictionAnswer | null {
  switch (draft.kind) {
    case "yes_no":
      return draft.value === null ? null : { kind: "yes_no", value: draft.value };
    case "percent": {
      const value = percentOf(draft.text);
      return value === null ? null : { kind: "percent", value };
    }
    case "regions":
      return { kind: "regions", value: [...draft.value] };
    case "action":
    case "size":
      return draft.actionIndex === null ? null : { kind: draft.kind, action_index: draft.actionIndex };
    case "band":
      return draft.band === null ? null : { kind: "band", band: draft.band };
  }
}

/** The reason's limits after trimming (S41, O-412, the PM's 3 to 1,000); the api cleans and checks again. */
export const REASON_MIN_CHARS = 3;
export const REASON_MAX_CHARS = 1000;

/** True when the trimmed reason is long enough to send and within the limit. */
export function reasonReady(reason: string): boolean {
  const length = reason.trim().length;
  return length >= REASON_MIN_CHARS && length <= REASON_MAX_CHARS;
}

/** The live count under the reason field: "42 / 1000". */
export function reasonCount(reason: string): string {
  return `${reason.length} / ${REASON_MAX_CHARS}`;
}

/** The actions a size answer chooses among: the node's bets, raises and all-ins. */
export function aggressiveActions(prompt: Pick<PredictionPrompt, "actions">): NodeAction[] {
  return prompt.actions.filter((action) => AGGRESSIVE_KINDS.has(action.kind));
}
