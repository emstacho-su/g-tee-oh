/**
 * Where an automated session stands in its review block, and how far a holdout round has got
 * (S32, R4.10, O-272, O-325, O-328). Pure.
 *
 * Why the web counts: POST /sessions answers the session's first block (PracticeSession.automated:
 * class, track, family, served, size, worked example), but no later read returns the block; each
 * prompt carries only its spot_class_key, track_key and worked_example. So the screen keeps a mark
 * per prompt shown (withMark: one per state version, started over for a new session) and
 * blockView walks them: the first prompt of the first block's class is hand served plus one;
 * a prompt of the same class as the one before, while that block has hands left, is the next
 * hand; anything else starts a new block at hand 1. A block's size is the first block's (the api
 * serves every block at one size, O-272); the family of a later class comes from the heat map
 * read (familyLookup), else none is shown. The class key is compared, never parsed (ADR 0004).
 *
 * holdoutView adds this session's decisions (one per prompt after the first, plus the one on the
 * reveal) to the round's answered count, capped at the total.
 */
import type { TrainerPrompt } from "../../contracts.js";
import type { ProgressHeatmap, TrackKey } from "../../progress/types.js";
import type { AutomatedBlock, HoldoutProgress } from "../../trainer/session-types.js";

export interface PromptMark {
  readonly sessionId: string;
  readonly version: number;
  readonly classKey: string | null;
  readonly trackKey: TrackKey | null;
  readonly workedExample: boolean;
}

export interface BlockView {
  readonly classKey: string | null;
  readonly trackKey: TrackKey | null;
  /** The class's action family as the api names it, or null when no read names it. */
  readonly family: string | null;
  /** The shown hand's place in its block, from 1. */
  readonly hand: number;
  readonly size: number;
  readonly workedExample: boolean;
}

export interface HoldoutView {
  readonly answered: number;
  readonly total: number;
}

export type FamilyOf = (classKey: string) => string | undefined;

function markOf(prompt: TrainerPrompt): PromptMark {
  return {
    sessionId: prompt.session_id,
    version: prompt.state_version,
    classKey: prompt.spot_class_key,
    trackKey: prompt.track_key,
    workedExample: prompt.worked_example,
  };
}

/** The marks with this prompt's added: unchanged for a prompt already marked, fresh for a new session. */
export function withMark(marks: readonly PromptMark[], prompt: TrainerPrompt): readonly PromptMark[] {
  const last = marks[marks.length - 1];
  if (last === undefined || last.sessionId !== prompt.session_id) return [markOf(prompt)];
  if (marks.some((mark) => mark.version === prompt.state_version)) return marks;
  return [...marks, markOf(prompt)];
}

/** Each heat map class's family, by its key; nothing while the heat map is not read. */
export function familyLookup(heatmap: ProgressHeatmap | undefined): FamilyOf {
  if (heatmap === undefined) return () => undefined;
  const families = new Map(heatmap.cells.map((cell) => [cell.spot_class_key, heatmap.rows[cell.row]?.family]));
  return (classKey) => families.get(classKey);
}

function firstBlockView(initial: AutomatedBlock): BlockView {
  return {
    classKey: initial.spot_class_key,
    trackKey: initial.track_key,
    family: initial.family,
    hand: Math.min(initial.served + 1, initial.size),
    size: initial.size,
    workedExample: initial.worked_example,
  };
}

function familyFor(classKey: string | null, initial: AutomatedBlock, familyOf: FamilyOf): string | null {
  if (classKey === null) return null;
  if (classKey === initial.spot_class_key) return initial.family;
  return familyOf(classKey) ?? null;
}

function step(previous: BlockView | null, mark: PromptMark, initial: AutomatedBlock, familyOf: FamilyOf): BlockView {
  const shown = { trackKey: mark.trackKey, workedExample: mark.workedExample };
  if (previous === null && mark.classKey === initial.spot_class_key) return { ...firstBlockView(initial), ...shown };
  if (previous !== null && mark.classKey === previous.classKey && previous.hand < previous.size) {
    return { ...previous, ...shown, hand: previous.hand + 1 };
  }
  const size = previous?.size ?? initial.size;
  return { classKey: mark.classKey, family: familyFor(mark.classKey, initial, familyOf), hand: 1, size, ...shown };
}

/** The block of the latest prompt; the first block before any prompt; null when there is no block. */
export function blockView(initial: AutomatedBlock | null, marks: readonly PromptMark[], familyOf: FamilyOf): BlockView | null {
  if (initial === null) return null;
  if (marks.length === 0) return firstBlockView(initial);
  return marks.reduce<BlockView | null>((view, mark) => step(view, mark, initial, familyOf), null);
}

/** The round's answered count after this session's decisions; `decided` is true on a reveal. */
export function holdoutView(initial: HoldoutProgress | null, marks: readonly PromptMark[], decided: boolean): HoldoutView | null {
  if (initial === null) return null;
  const decisions = Math.max(0, marks.length - 1) + (decided ? 1 : 0);
  return { answered: Math.min(initial.total, initial.answered + decisions), total: initial.total };
}
