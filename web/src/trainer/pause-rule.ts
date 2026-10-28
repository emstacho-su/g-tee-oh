/**
 * Whether the reveal pauses, and when it does not, how long it shows (S26, R3.13, O-314, O-284).
 * Pure: no input/output, no clock and no randomness.
 *
 * Mechanism: spot mode (stop_rule after_action) always pauses on the reveal until Next (O-284),
 * whatever trainer.pause says. Street and full-hand modes follow trainer.pause: every_action
 * pauses on every reveal; after_mistake pauses when the grade label is an inaccuracy, a mistake or
 * a blunder; never does not pause. A reveal that does not pause shows a short result chip and
 * continues by itself after the speed delay (slow, normal, fast), halved when quick_result is on.
 * The screen schedules that continue through the injected timer (use-spot-session.ts). Missing
 * settings mean spot mode, so a context without run settings behaves as S25 did.
 */
import type { FeedbackLabel, TrainerSettings } from "../contracts.js";
import type { RevealSpeed, RunSettings } from "./session-types.js";

/** How long a reveal that does not pause stays on screen, per trainer.speed (O-314). */
export const AUTO_CONTINUE_MS: Readonly<Record<RevealSpeed, number>> = {
  slow: 2500,
  normal: 1200,
  fast: 500,
};

/** quick_result divides the delay by this. */
export const QUICK_RESULT_DIVISOR = 2;

/** The labels after_mistake pauses on. */
export const MISTAKE_LABELS: ReadonlySet<FeedbackLabel> = new Set<FeedbackLabel>(["inaccuracy", "mistake", "blunder"]);

/** S25's spot mode: one decision per hand and a reveal that always pauses (O-284). */
export const SPOT_MODE_SETTINGS: RunSettings = {
  stop_rule: "after_action",
  pause: "every_action",
  speed: "normal",
  quick_result: false,
};

/** The run settings of a drill's trainer settings. */
export function runSettingsOf(trainer: TrainerSettings): RunSettings {
  return { stop_rule: trainer.stop_rule, pause: trainer.pause, speed: trainer.speed, quick_result: trainer.quick_result };
}

/** Whether the reveal of a decision graded `label` waits for Next. */
export function revealPauses(settings: RunSettings | undefined, label: FeedbackLabel): boolean {
  const run = settings ?? SPOT_MODE_SETTINGS;
  if (run.stop_rule === "after_action") return true;
  switch (run.pause) {
    case "every_action":
      return true;
    case "after_mistake":
      return MISTAKE_LABELS.has(label);
    case "never":
      return false;
  }
}

/** The delay before the screen continues by itself, or null when the reveal pauses. */
export function autoContinueMs(settings: RunSettings | undefined, label: FeedbackLabel): number | null {
  if (settings === undefined || revealPauses(settings, label)) return null;
  const delay = AUTO_CONTINUE_MS[settings.speed];
  return settings.quick_result ? delay / QUICK_RESULT_DIVISOR : delay;
}
