/**
 * The decision's response timer (S25, R3.13, O-284; S31's O-273 Easy-grade timing reads the same
 * response_ms). Pure: every time comes in as an argument from the injected clock.
 *
 * Mechanism: the timer starts when the prompt is shown. While the screen is paused (the RNG
 * explainer or another dialog is open over it) the time does not count: pause remembers when the
 * pause began, resume adds the paused span to pausedMs. activeMs(timer, at) is the time from shown
 * to `at` minus every paused span, including a pause still open at `at`, and never below zero. A
 * pause while paused and a resume while running return the same timer, so callers can send them
 * freely.
 */
export interface ResponseTimer {
  readonly shownAt: number;
  /** The total of the pauses that have ended. */
  readonly pausedMs: number;
  /** When the current pause began, or null while the timer runs. */
  readonly pausedSince: number | null;
}

export function startTimer(shownAt: number): ResponseTimer {
  return { shownAt, pausedMs: 0, pausedSince: null };
}

export function pauseTimer(timer: ResponseTimer, at: number): ResponseTimer {
  return timer.pausedSince === null ? { ...timer, pausedSince: at } : timer;
}

export function resumeTimer(timer: ResponseTimer, at: number): ResponseTimer {
  if (timer.pausedSince === null) return timer;
  return { ...timer, pausedMs: timer.pausedMs + Math.max(0, at - timer.pausedSince), pausedSince: null };
}

export function activeMs(timer: ResponseTimer, at: number): number {
  const openPause = timer.pausedSince === null ? 0 : Math.max(0, at - timer.pausedSince);
  return Math.max(0, Math.round(at - timer.shownAt - timer.pausedMs - openPause));
}
