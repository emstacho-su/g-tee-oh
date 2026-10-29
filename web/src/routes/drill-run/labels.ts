/**
 * Fixed text and keys of the drill run screen (S25, S26, S46, R3.13, R3.30, O-285, O-314): the
 * result chip's labels, the screen's sentences and the session hotkeys. The start panel names a
 * drill's grouping, stop rule and pause rule from src/drills/labels.ts, the one map the library
 * and the builder use too (PR #30 review LOW 10), so this file holds no second wording for them.
 * Keys go through useHotkey, so the ? overlay lists them under SESSION_SCOPE; the action keys
 * (components/trainer/action-keys.ts) and I (the Mixed-frequency mode explainer hook) are
 * registered by their own components. S46 (R3.30, design rule 9): Enter means the same as N, End
 * session moved from the bare E to Shift+E so a reflex press never breaks the flow, Shift+S opens
 * Study (R3.34) and R is reserved for repeat hand (hotkeys/reserved.ts, O-473). The S and U keys
 * of the confidence tap left with it (O-345).
 */
import type { FeedbackLabel } from "../../contracts.js";

export { REPEAT_HAND_KEY } from "../../hotkeys/index.js";
/** The five label definitions and the roll note (S46, R3.8, ADR 0024), defined once beside the summary. */
export { GRADE_DEFINITIONS, GRADE_ROLL_NOTE } from "../../components/trainer/grade-definitions.js";

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
/** Enter does what N does (R3.30). */
export const NEXT_HAND_ENTER_KEY = "Enter";
/** End session is the chord Shift+E (R3.30, O-474). */
export const END_SESSION_KEY = "E";
export const END_SESSION_BINDING = { key: END_SESSION_KEY, shift: true } as const;
/** Study this spot is the chord Shift+S, in the feedback scope (R3.34). */
export const STUDY_SPOT_KEY = "S";
export const STUDY_SPOT_BINDING = { key: STUDY_SPOT_KEY, shift: true } as const;

export const SESSION_TEXT = {
  heading: "Drill session",
  start: "Start session",
  starting: "Starting the session",
  rngSwitch: "Mixed-frequency mode",
  rngHint:
    "Each decision shows a roll from 1 to 100 first, to practise mixing your actions. After the decision the bands show where it fell; Best is still the highest-EV action.",
  nextHand: "Next hand",
  endSession: "End session",
  studySpot: "Study this spot",
  confirmTitle: "End this session?",
  confirmDescription: "The recap shows how the session went. A decision you have not made yet is not graded.",
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
  continuing: "Continuing by itself",
  openLibrary: "Open the library",
  /** The start panel's chip list (S38). */
  drillSettings: "Drill settings",
} as const;
