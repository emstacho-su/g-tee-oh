/**
 * The replay plan of the actions before the hero's decision (S38, R3.13, O-381 to O-383,
 * ADR 0004). Pure.
 *
 * Mechanism: planReplay compares the prompt on screen with the one before it. A new hand (another
 * session or hand_no, or a history the old one is not a prefix of) replays its whole dealt line;
 * a continuing hand (street and full-hand modes) replays only the entries added since (O-382).
 * The plan is keyed by session and state_version, so the same decision never replays twice.
 * stepDurations gives each step its time: 200 ms for a fold, 500 ms for any other action, scaled
 * by the drill's speed (slow 1.5x, fast 0.5x), and a line longer than the cap (2.5 s, scaled by
 * the speed too) is shortened evenly so a user is never kept waiting (O-381). seatActions and
 * logLines turn the first n entries into what each seat shows and what the screen reader log
 * says. Every word is the api's own history label; nothing is computed from the amounts.
 */
import type { Position, TrainerPrompt } from "../contracts.js";

export type HistoryEntry = TrainerPrompt["history"][number];
export type ReplaySpeed = "slow" | "normal" | "fast";

export const REPLAY_TIMING = { foldMs: 200, actionMs: 500, capMs: 2500 } as const;
export const SPEED_SCALE: Readonly<Record<ReplaySpeed, number>> = { slow: 1.5, normal: 1, fast: 0.5 };

export const LOG_TEXT = {
  yourTurn: "Your turn",
  noAction: "No action before you",
} as const;

const FOLD_TOKEN = "f";
const CHECK_TOKEN = "x";

export interface ReplayStep extends HistoryEntry {
  readonly durationMs: number;
}

export interface ReplayPlan {
  /** Session and state version: the same key never replays again. */
  readonly key: string;
  /** Names the hand, so log keys differ across hands and stay stable within one. */
  readonly handKey: string;
  /** The whole history on screen, in order. */
  readonly history: readonly HistoryEntry[];
  /** The index of the first entry that replays; the entries before it show at once. */
  readonly firstNew: number;
  readonly steps: readonly ReplayStep[];
}

export interface SeatAction {
  readonly label: string;
  readonly folded: boolean;
  /** The chip's text for an action that puts chips in (call, bet, raise, all-in, limp, straddle). */
  readonly chip: string | null;
}

export function replayKey(prompt: TrainerPrompt): string {
  return `${prompt.session_id}:${prompt.state_version}`;
}

function handKeyOf(prompt: TrainerPrompt): string {
  return `${prompt.session_id}:${prompt.hand_no}`;
}

function sameEntry(left: HistoryEntry, right: HistoryEntry): boolean {
  return left.position === right.position && left.token === right.token && left.label === right.label;
}

/** Where the replay starts in current.history (O-382). */
export function firstNewEntry(previous: TrainerPrompt | null, current: TrainerPrompt): number {
  if (previous === null || handKeyOf(previous) !== handKeyOf(current)) return 0;
  const before = previous.history;
  if (before.length > current.history.length) return 0;
  const continues = before.every((entry, index) => {
    const now = current.history[index];
    return now !== undefined && sameEntry(entry, now);
  });
  return continues ? before.length : 0;
}

/** Each step's time in milliseconds (O-381). */
export function stepDurations(entries: readonly HistoryEntry[], speed: ReplaySpeed): number[] {
  const scale = SPEED_SCALE[speed];
  const base = entries.map((entry) => (entry.token === FOLD_TOKEN ? REPLAY_TIMING.foldMs : REPLAY_TIMING.actionMs) * scale);
  const total = base.reduce((sum, ms) => sum + ms, 0);
  const cap = REPLAY_TIMING.capMs * scale;
  if (total <= cap) return base;
  const shrink = cap / total;
  return base.map((ms) => ms * shrink);
}

export function planReplay(previous: TrainerPrompt | null, current: TrainerPrompt, speed: ReplaySpeed): ReplayPlan {
  const firstNew = firstNewEntry(previous, current);
  const fresh = current.history.slice(firstNew);
  const durations = stepDurations(fresh, speed);
  return {
    key: replayKey(current),
    handKey: handKeyOf(current),
    history: current.history,
    firstNew,
    steps: fresh.map((entry, index) => ({ ...entry, durationMs: durations[index] ?? 0 })),
  };
}

/**
 * What each seat shows after the first `shown` entries (S38 review round 1). Badges and chips belong
 * to the street being played: when an entry's street (the api's history entry street) differs from
 * the entry before it, a new street has started, the pot holds the earlier bets, and every seat's
 * badge and chip clear. A fold folds the seat for the rest of the hand. Entries without a street
 * (stored before the field existed) count as the street of the entry before them, so an old history
 * stays one street; the web never infers a street from the actions.
 */
export function seatActions(history: readonly HistoryEntry[], shown: number): ReadonlyMap<Position, SeatAction> {
  const folds = new Map<Position, SeatAction>();
  let street: HistoryEntry["street"];
  let onStreet = new Map<Position, SeatAction>();
  for (const entry of history.slice(0, shown)) {
    if (entry.street !== undefined && street !== undefined && entry.street !== street) onStreet = new Map();
    street = entry.street ?? street;
    const folded = entry.token === FOLD_TOKEN;
    const action: SeatAction = { label: entry.label, folded, chip: folded || entry.token === CHECK_TOKEN ? null : entry.label };
    if (folded) folds.set(entry.position, action);
    onStreet.set(entry.position, action);
  }
  return new Map([...folds, ...onStreet]);
}

/** The log's lines after the first `shown` entries, with "Your turn" once the replay has ended (O-383). */
export function logLines(history: readonly HistoryEntry[], shown: number, finished: boolean): string[] {
  const lines = history.slice(0, shown).map((entry) => `${entry.position}: ${entry.label}`);
  if (!finished) return lines;
  return [...(history.length === 0 ? [LOG_TEXT.noAction] : lines), LOG_TEXT.yourTurn];
}
