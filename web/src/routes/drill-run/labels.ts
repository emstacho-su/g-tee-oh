/**
 * Fixed text and keys of the drill run screen (S25, S26, S46, R3.13, R3.30, O-285, O-314): the
 * result chip's labels, the screen's sentences and the session hotkeys. The start panel names a
 * drill's grouping, stop rule and pause rule from src/drills/labels.ts, the one map the library
 * and the builder use too (PR #30 review LOW 10), so this file holds no second wording for them.
 * Keys go through useHotkey, so the ? overlay lists them under SESSION_SCOPE; the action keys
 * (components/trainer/action-keys.ts) and I (the Mixed-frequency mode explainer hook) are
 * registered by their own components. S46 (R3.30, design rule 9): Enter means the same as N, End
 * session moved from the bare E to Shift+E so a reflex press never breaks the flow, and R is
 * reserved for repeat hand (hotkeys/reserved.ts, O-473). The S and U keys of the confidence tap
 * left with it (O-345).
 */
// The grade names, marks and definitions live in components/trainer/grade-definitions.tsx (S46,
// PR #45 review rounds 1 and 2), the reserved keys in hotkeys/reserved.ts; this file holds neither.

export const LIBRARY_PATH = "/library";

/** The trainer session's scope, defined once beside the reserved keys (PR #45 review round 3, finding 4). */
export { SESSION_SCOPE } from "../../hotkeys/index.js";
export const NEXT_HAND_KEY = "N";
/** Enter does what N does (R3.30). */
export const NEXT_HAND_ENTER_KEY = "Enter";
/** End session is the chord Shift+E (R3.30, O-474). */
export const END_SESSION_KEY = "E";
export const END_SESSION_BINDING = { key: END_SESSION_KEY, shift: true } as const;
/** Study this spot is the chord Shift+S, in the feedback's scope (S46, R3.34, item 11). */
export const STUDY_SPOT_BINDING = { key: "S", shift: true } as const;

/**
 * The decision area's name, which the focus lands on when a new prompt arrives (PR #45 review round 4,
 * finding f): the hero's seat and the street, read from the served prompt.
 */
export function decisionAreaName(prompt: { readonly hero_position: string; readonly street: string }): string {
  return `Your decision: ${prompt.hero_position} on the ${prompt.street}`;
}

export const SESSION_TEXT = {
  heading: "Drill session",
  start: "Start session",
  starting: "Starting the session",
  rngSwitch: "Mixed-frequency mode",
  rngHint:
    "Each decision shows a roll from 1 to 100 first, to practise mixing your actions. After the decision the bands show where it fell; Best is still the highest-EV action.",
  nextHand: "Next hand",
  /** Next on the last planned hand's reveal (R3.31). */
  finishSession: "Finish session",
  endSession: "End session",
  /** The reveal's link to the decision's node in Study, in a new tab (R3.34). */
  studySpot: "Study this spot",
  /** Said beside Ask when the configuration list did not load, so the link is not there (R3.34). */
  studyUnavailable: "Study this spot is unavailable: the configuration list did not load.",
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

/**
 * The reveal notice before the decision (S46, R3.33, item 14, O-471): a panel that shows the answer,
 * or a worked example, leaves the decision unrated. The panels themselves wait on O-471 (the
 * prompt carries no node identity yet), so the notice names them and says so.
 */
export const REVEAL_TEXT = {
  /** The lead of the notice; the ranked reason follows it (unrated-reason.ts preDecisionReason, S48 round 5 verifier). */
  notRated: "Not rated.",
  show: "Show this drill's panels",
  hide: "Hide this drill's panels",
  workedExample: "This is a worked example: the answer is part of the lesson.",
  later: "These panels show here before the decision in a later version; for now they open on the reveal.",
} as const;
