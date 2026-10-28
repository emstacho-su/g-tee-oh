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
 * so does any action key (1 to 9), so a user who has seen enough never waits; the page wires
 * `replaying` into the action bar and the paused response timer. Reduced motion (the system
 * setting, or the reducedMotion option) shows the end state at once with no timer, and turning it
 * on mid-replay finishes the replay. A null prompt is an idle replay and keeps the last prompt, so
 * the next one is still compared with it.
 */
import { useCallback, useEffect, useState } from "react";

import { usePrefersReducedMotion } from "../components/table/reduced-motion.js";
import type { Position, TrainerPrompt } from "../contracts.js";
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

/** The action keys that finish a replay (the action bar's 1 to 9). */
const SKIP_KEY = /^[1-9]$/;

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
    seats: seatActions(plan.history, shown),
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
  useEffect(() => {
    if (!replaying) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (SKIP_KEY.test(event.key)) skip();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [replaying, skip]);

  return prompt === null ? viewOf(EMPTY_TRACK, skip) : viewOf(current, skip);
}
