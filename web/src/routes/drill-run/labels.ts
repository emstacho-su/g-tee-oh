/**
 * Fixed text and keys of the drill run screen (S25, R3.13, O-285): the names the start panel shows
 * for a drill's grouping and stop rule, and the session hotkeys. Keys go through useHotkey, so the
 * ? overlay lists them under SESSION_SCOPE; 1 to 9 (ActionBar), S and U (ConfidenceTap) and I (the
 * RNG explainer hook) are registered by their own components.
 */
import type { Grouping } from "../../contracts.js";
import type { StopRule } from "../../trainer/session-types.js";

export const GROUPING_NAMES: Readonly<Record<Grouping, string>> = {
  standard: "Standard",
  grouped: "Grouped",
  simple: "Simple",
};

export const STOP_RULE_NAMES: Readonly<Record<StopRule, string>> = {
  after_action: "After each action",
  end_of_street: "End of street",
  end_of_hand: "End of hand",
};

export const SESSION_SCOPE = "Session";
export const NEXT_HAND_KEY = "N";
export const END_SESSION_KEY = "E";

export const SESSION_TEXT = {
  heading: "Drill session",
  start: "Start session",
  starting: "Starting the session",
  rngSwitch: "RNG mode",
  rngHint:
    "Each decision shows a roll from 1 to 100 first. After the reveal, the roll picks one action of the hand's mixed strategy.",
  nextHand: "Next hand",
  endSession: "End session",
  confirmTitle: "End this session?",
  confirmDescription: "The recap shows how the session went. A decision you have not tapped is not graded.",
  keepPlaying: "Keep playing",
  grading: "Grading your decision",
  loadingPrompt: "Dealing the next hand",
  loadingDrill: "Loading the drill",
  ending: "Ending the session",
  retry: "Try again",
  recapHeading: "Session recap",
  startAnother: "Start another session",
} as const;
