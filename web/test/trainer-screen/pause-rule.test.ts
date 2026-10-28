/**
 * The reveal's pause rule (S26, R3.13, O-314, O-284): spot mode always pauses; street and full-hand
 * modes follow trainer.pause at every grade label, and a reveal that does not pause continues by
 * itself after the speed delay, halved by quick_result.
 */
import { describe, expect, it } from "vitest";

import type { FeedbackLabel } from "../../src/contracts.js";
import {
  AUTO_CONTINUE_MS,
  QUICK_RESULT_DIVISOR,
  SPOT_MODE_SETTINGS,
  autoContinueMs,
  revealPauses,
  runSettingsOf,
} from "../../src/trainer/pause-rule.js";
import type { PauseRule, RunSettings, StopRule } from "../../src/trainer/session-types.js";
import { fixtureTrainerSettings } from "../../src/fixtures/trainer.js";

const LABELS: readonly FeedbackLabel[] = ["best", "correct", "inaccuracy", "mistake", "blunder"];
const MISTAKES: ReadonlySet<FeedbackLabel> = new Set(["inaccuracy", "mistake", "blunder"]);
const PAUSES: readonly PauseRule[] = ["every_action", "after_mistake", "never"];
const HAND_MODES: readonly StopRule[] = ["end_of_street", "end_of_hand"];

function settings(stop_rule: StopRule, pause: PauseRule, extra: Partial<RunSettings> = {}): RunSettings {
  return { stop_rule, pause, speed: "normal", quick_result: false, ...extra };
}

function expectedPause(pause: PauseRule, label: FeedbackLabel): boolean {
  if (pause === "every_action") return true;
  if (pause === "after_mistake") return MISTAKES.has(label);
  return false;
}

const HAND_ROWS = HAND_MODES.flatMap((mode) => PAUSES.flatMap((pause) => LABELS.map((label) => [mode, pause, label] as const)));

describe("R3.13 pause rule", () => {
  it.each(PAUSES.flatMap((pause) => LABELS.map((label) => [pause, label] as const)))(
    "R3.13 spot mode with pause %s pauses at label %s (O-284)",
    (pause, label) => {
      expect(revealPauses(settings("after_action", pause), label)).toBe(true);
      expect(autoContinueMs(settings("after_action", pause), label)).toBeNull();
    },
  );

  it.each(HAND_ROWS)("R3.13 %s with pause %s at label %s follows trainer.pause (O-314)", (mode, pause, label) => {
    const run = settings(mode, pause);
    const pauses = expectedPause(pause, label);
    expect(revealPauses(run, label)).toBe(pauses);
    expect(autoContinueMs(run, label)).toBe(pauses ? null : AUTO_CONTINUE_MS.normal);
  });

  it("R3.13 the delay follows the speed and quick_result halves it", () => {
    expect(AUTO_CONTINUE_MS).toEqual({ slow: 2500, normal: 1200, fast: 500 });
    for (const speed of ["slow", "normal", "fast"] as const) {
      expect(autoContinueMs(settings("end_of_street", "never", { speed }), "best")).toBe(AUTO_CONTINUE_MS[speed]);
      expect(autoContinueMs(settings("end_of_hand", "never", { speed, quick_result: true }), "best")).toBe(
        AUTO_CONTINUE_MS[speed] / QUICK_RESULT_DIVISOR,
      );
    }
  });

  it("R3.13 run settings come from the drill's trainer settings; spot mode is the default", () => {
    expect(runSettingsOf(fixtureTrainerSettings)).toEqual({ stop_rule: "after_action", pause: "every_action", speed: "normal", quick_result: false });
    expect(SPOT_MODE_SETTINGS.stop_rule).toBe("after_action");
    expect(revealPauses(undefined, "best")).toBe(true);
  });
});
