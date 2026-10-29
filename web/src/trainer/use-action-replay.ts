/**
 * useActionReplay plays the actions before the hero's decision on the table, one step at a time
 * (S38, R3.13, O-381 to O-383, PM note b).
 *
 * Mechanism: the hook keeps the last prompt it planned for and, when a prompt with a new key
 * (session and state_version) arrives, plans the replay against it (action-replay.ts): a new hand
 * plays its whole line, a continuing hand only what was added. The plan is adopted while
 * rendering (React's derived-state pattern), so the first frame of a new prompt already shows the
 * first step. One timer at a time moves to the next step after the active step's duration; the
 * last step's end finishes the replay and the log adds "Your turn". skip() finishes at once and
 * so does the space bar (S46, R3.30: the action keys no longer do, so a key pressed as the replay
 * ends never submits), so a user who has seen enough never waits; the page wires `replaying`
 * into the action bar and the paused response timer. Reduced motion (the system
 * setting, or the reducedMotion option) shows the end state at once with no timer, and turning it
 * on mid-replay finishes the replay. A null prompt is an idle replay and keeps the last prompt, so
 * the next one is still compared with it.
 */
import { useCallback, useEffect, useState } from "react";

import { usePrefersReducedMotion } from "../components/table/reduced-motion.js";
import type { Position, TrainerPrompt } from "../contracts.js";
import { isActivatableTarget } from "../hotkeys/index.js";
import {
  LOG_TEXT,
  logLines,
  planReplay,
  replayKey,
  seatActions,
  type HistoryEntry,
  type ReplayPlan,
  type ReplaySpeed,
  type SeatAction,
} from "./action-replay.js";

export interface ReplayOptions {
  /** The drill's trainer.speed; normal when absent. */
  speed?: ReplaySpeed;
  /** Overrides the prefers-reduced-motion media query when given. */
  reducedMotion?: boolean;
  /**
   * Whether the space bar finishes the replay: true by default; the session turns it off while a
   * dialog covers the screen, so a key meant for the dialog never touches the table.
   */
  keySkip?: boolean;
}

export interface ReplayLogLine {
  /** Stable within a hand, different across hands, so a screen reader hears only additions. */
  readonly key: string;
  readonly text: string;
}

export interface ActionReplay {
  /** The plan's key, or null with no prompt. */
  readonly key: string | null;
  readonly history: readonly HistoryEntry[];
  /** How many history entries are on screen. */
  readonly shown: number;
  /** The history index being played, or null once finished. */
  readonly activeIndex: number | null;
  readonly activePosition: Position | null;
  /** The active step's duration, for the chip's slide. */
  readonly stepMs: number | null;
  readonly replaying: boolean;
  readonly seats: ReadonlyMap<Position, SeatAction>;
  readonly log: readonly ReplayLogLine[];
  /** Finishes the replay at once. */
  readonly skip: () => void;
}

/** The key that finishes a replay: the space bar (S46, R3.30, O-475; the digits were S38's). */
const SKIP_KEY = " ";
/** A field the user types into: Space there is text, never a skip (review round 1, 6). */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select, [contenteditable='true']");
}

/**
 * Space with no modifier, pressed outside a field and a focused control (dispatch.ts: a button,
 * link, field or any tabindex widget such as the range matrix, never a disabled one), and not
 * already handled by a widget (defaultPrevented: the matrix selects a cell on Space). This window
 * listener runs in the bubble phase, after React's handlers (PR #45 review round 2, finding 1).
 */
function isSkipKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  if (event.key !== SKIP_KEY) return false;
  const { target } = event;
  return !isEditable(target) && !isActivatableTarget(target);
}

interface Track {
  /** The prompt the plan was made for: the previous prompt of the next plan. */
  readonly prompt: TrainerPrompt | null;
  readonly plan: ReplayPlan | null;
  /** How many of the plan's steps have started; step started - 1 is the active one. */
  readonly started: number;
  readonly finished: boolean;
}

const EMPTY_TRACK: Track = { prompt: null, plan: null, started: 0, finished: true };
const EMPTY_SEATS: ReadonlyMap<Position, SeatAction> = new Map();

function finish(track: Track): Track {
  if (track.plan === null || track.finished) return track;
  return { ...track, started: track.plan.steps.length, finished: true };
}

function startTrack(previous: TrainerPrompt | null, prompt: TrainerPrompt, speed: ReplaySpeed, reduced: boolean): Track {
  const plan = planReplay(previous, prompt, speed);
  const fresh: Track = { prompt, plan, started: plan.steps.length === 0 ? 0 : 1, finished: plan.steps.length === 0 };
  return reduced ? finish(fresh) : fresh;
}

function advance(track: Track, key: string): Track {
  if (track.plan === null || track.plan.key !== key || track.finished) return track;
  return track.started < track.plan.steps.length ? { ...track, started: track.started + 1 } : finish(track);
}

function logOf(plan: ReplayPlan, shown: number, finished: boolean): ReplayLogLine[] {
  const lines = logLines(plan.history, shown, finished);
  return lines.map((text, index) => {
    if (text === LOG_TEXT.yourTurn && index === lines.length - 1 && finished) return { key: `${plan.key}:turn`, text };
    if (text === LOG_TEXT.noAction && plan.history.length === 0) return { key: `${plan.handKey}:none`, text };
    return { key: `${plan.handKey}:${index}`, text };
  });
}

function viewOf(track: Track, skip: () => void): ActionReplay {
  const { plan } = track;
  if (plan === null) {
    return { key: null, history: [], shown: 0, activeIndex: null, activePosition: null, stepMs: null, replaying: false, seats: EMPTY_SEATS, log: [], skip };
  }
  const shown = plan.firstNew + track.started;
  const activeStep = track.finished ? undefined : plan.steps[track.started - 1];
  return {
    key: plan.key,
    history: plan.history,
    shown,
    activeIndex: activeStep === undefined ? null : shown - 1,
    activePosition: activeStep?.position ?? null,
    stepMs: activeStep?.durationMs ?? null,
    replaying: !track.finished,
    seats: seatActions(plan.history, shown, track.finished ? plan.street : undefined),
    log: logOf(plan, shown, track.finished),
    skip,
  };
}

export function useActionReplay(prompt: TrainerPrompt | null, options: ReplayOptions = {}): ActionReplay {
  const speed = options.speed ?? "normal";
  const systemReduced = usePrefersReducedMotion();
  const reduced = options.reducedMotion ?? systemReduced;
  const [track, setTrack] = useState<Track>(() => (prompt === null ? EMPTY_TRACK : startTrack(null, prompt, speed, reduced)));
  const skip = useCallback(() => setTrack(finish), []);

  let current = track;
  if (prompt !== null && (current.plan === null || current.plan.key !== replayKey(prompt))) {
    current = startTrack(current.prompt, prompt, speed, reduced);
  }
  if (reduced && !current.finished) current = finish(current);
  if (current !== track) setTrack(current);

  const key = current.plan?.key ?? null;
  const stepMs = current.finished ? null : (current.plan?.steps[current.started - 1]?.durationMs ?? null);
  useEffect(() => {
    if (key === null || stepMs === null) return undefined;
    const timer = window.setTimeout(() => setTrack((now) => advance(now, key)), stepMs);
    return () => window.clearTimeout(timer);
  }, [key, current.started, stepMs]);

  const replaying = !current.finished;
  const keySkip = options.keySkip ?? true;
  useEffect(() => {
    if (!replaying || !keySkip) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSkipKey(event)) return;
      // Space on the page would scroll it; the skip takes the key.
      event.preventDefault();
      skip();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [replaying, keySkip, skip]);

  return prompt === null ? viewOf(EMPTY_TRACK, skip) : viewOf(current, skip);
}
