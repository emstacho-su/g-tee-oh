/**
 * Fixed text and keys of the drill run screen (S25, S26, R3.13, O-285, O-314): the result chip's
 * labels, the screen's sentences and the session hotkeys. The start panel names a drill's grouping,
 * stop rule and pause rule from src/drills/labels.ts, the one map the library and the builder use
 * too (PR #30 review LOW 10), so this file holds no second wording for them. Keys go through
 * useHotkey, so the ? overlay lists them under SESSION_SCOPE; 1 to 9 (ActionBar), S and U
 * (ConfidenceTap) and I (the RNG explainer hook) are registered by their own components.
 */
import type { FeedbackLabel } from "../../contracts.js";

/** The grade label in words with its chess-style mark, so color is never the only signal (S26). */
export const RESULT_LABELS: Readonly<Record<FeedbackLabel, string>> = {
  best: "★ Best",
  correct: "✓ Correct",
  inaccuracy: "?! Inaccuracy",
  mistake: "? Mistake",
  blunder: "?? Blunder",
};

export const LIBRARY_PATH = "/library";

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
  stopRule: "Stop rule",
  grouping: "Grouping",
  /** The builder's name for trainer.pause, so both screens call it the same. */
  pauseRule: "Pause",
  closingActions: "Closing actions",
  flop: "Flop",
  continuing: "Continuing by itself",
  openLibrary: "Open the library",
} as const;
