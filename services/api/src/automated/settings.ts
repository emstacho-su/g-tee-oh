/**
 * The trainer settings and session spot of an automated session (R4.10, O-272).
 *
 * - Settings: one decision per hand (stop rule after_action, forced), grouping and RNG mode from
 *   the body's partial settings, every panel on except the answer-revealing ones
 *   (grading/policy.ts ANSWER_REVEALING_PANELS), which a worked-example block turns on instead
 *   (the prompt's worked_example; the hook stores panels_revealed from the block). Every other
 *   field is the trainer's plain default; the body cannot change it.
 * - Spot: S23 dealing reads only hands and alternate_seats from it; preflop_action is a schema
 *   placeholder, since an automated session's hero spots come from the class catalog.
 */
import { ANSWER_REVEALING_PANELS } from "../grading/policy.js";
import { PANEL_KEYS, trainerSettingsSchema, type TrainerSettings } from "../schemas/drills.js";
import type { SessionCreateBody } from "../sessions/session-call.js";
import { sessionSpotSchema, type SessionSpot } from "../sessions/spot.js";

const PANELS: TrainerSettings["panels"] = Object.fromEntries(
  PANEL_KEYS.map((key) => [key, !ANSWER_REVEALING_PANELS.includes(key)]),
);

export const AUTOMATED_TRAINER_DEFAULTS: TrainerSettings = trainerSettingsSchema.parse({
  stop_rule: "after_action",
  input: "actions",
  grouping: "standard",
  rng: false,
  pause: "never",
  speed: "normal",
  quick_result: false,
  tables: 1,
  timebank_s: null,
  panels: PANELS,
});

/** The automated session's settings: the defaults with the body's grouping and rng (O-272). */
export function automatedSettings(overrides: SessionCreateBody["settings"]): TrainerSettings {
  return trainerSettingsSchema.parse({
    ...AUTOMATED_TRAINER_DEFAULTS,
    ...(overrides?.grouping === undefined ? {} : { grouping: overrides.grouping }),
    ...(overrides?.rng === undefined ? {} : { rng: overrides.rng }),
  });
}

/** The session spot S23 dealing reads: every hand, no seat alternation. */
export const AUTOMATED_SESSION_SPOT: SessionSpot = sessionSpotSchema.parse({
  preflop_action: ["rfi"],
  hands: { mode: "all" },
  alternate_seats: false,
});
