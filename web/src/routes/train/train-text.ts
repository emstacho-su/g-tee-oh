/**
 * Fixed text and paths of /train (S32, R4.10, R4.12, O-325, O-328): the start panels, the block
 * banner, the recap and the problems a start in this screen can meet. Wording names what the api
 * does (O-272: blocks of a class, worked examples unrated; O-276: holdout never rated) in plain
 * words. A problem sentence is fixed per kind (S24 precedent), so no server detail is shown.
 */
import { problemMessage, type SpotProblem } from "../../trainer/spot-problem.js";
import type { SettingsSectionSlug } from "../settings/sections.js";

export type TrainMode = "automated" | "holdout";

export const TRAIN_PATH = "/train";
export const PROGRESS_PATH = "/progress";
// Each start-panel link opens the settings page that holds what it changes (S36, O-360).
export const SCOPE_SETTINGS_SECTION = "configurations" satisfies SettingsSectionSlug;
export const DEFAULTS_SETTINGS_SECTION = "session-defaults" satisfies SettingsSectionSlug;
export const HOLDOUT_SEARCH = { mode: "holdout" } as const;

export const TRAIN_TEXT = {
  automatedHeading: "Automated training",
  holdoutHeading: "Holdout retest",
  automatedIntro:
    "Spots come from your review queue: classes that are due, classes you have not seen yet and your costliest leaks, a few hands of one class at a time. Rated decisions move your rating.",
  holdoutIntro:
    "This month's retest of spots kept out of training. It is never rated: it checks that your rating holds on spots you have not drilled.",
  startAutomated: "Start training",
  startHoldout: "Start the retest",
  starting: "Starting the session",
  scope: "Configurations",
  scopeAll: "All covered configurations",
  scopeLoading: "Loading the configuration names",
  scopeError: "The configuration names could not be loaded.",
  grouping: "Grouping",
  rng: "Mixed-frequency mode",
  on: "On",
  off: "Off",
  changeScope: "Change the configurations",
  changeDefaults: "Change the session defaults",
  retry: "Try again",
  workedExample: "Worked example: panels visible, not rated",
  ratedBlock: "Rated block: first attempts count toward your rating",
  unratedSession: "Not rated",
  holdoutBanner: "Holdout retest: not rated",
  noTrack: "No rating track",
  recapHeading: "Session recap",
  decisions: "Decisions",
  ratedDecisions: "Rated decisions",
  meanScore: "Mean score",
  noneRated: "None rated",
  evLoss: "EV loss",
  ratingTable: "Rating by track",
  track: "Track",
  before: "Before",
  after: "After",
  change: "Change",
  newRating: "new",
  tierHeading: "Tier",
  unlocksHeading: "Unlocked",
  nothingRated:
    "Nothing in this session was rated, so your rating did not move. That happens when every decision was a worked example (the first block of a class you had not seen) or a holdout retest, which are never rated, or when a decision was graded with a noise flag.",
  trainAgain: "Train again",
  seeProgress: "See progress",
  retestStart: "Start this month's retest",
  retestResume: "Resume this month's retest",
  retestComplete: "Retest complete for this month",
  // S38 restyle: the start cards' headings and the chip list's name.
  automatedCardTitle: "What this session uses",
  holdoutCardTitle: "What the retest is",
  sessionSettings: "Session settings",
} as const;

const NO_CLASS_IN_SCOPE =
  "The library covers no spot class in this scope yet. Its gaps were queued for the library builder; try again once it has built them, or choose more configurations in Settings.";
const HOLDOUT_COMPLETE = "This month's retest is complete. The next round opens on the first of next month.";
const NO_HOLDOUT_ITEMS = "No retest spots are drawn for this round yet. Try again later.";

/** The api's holdout start problems (services/api/src/http/problem.ts, S31) and their sentences. */
export const HOLDOUT_START_MESSAGES: Readonly<Record<string, string>> = {
  "holdout-complete": HOLDOUT_COMPLETE,
  "no-holdout-items": NO_HOLDOUT_ITEMS,
};

/**
 * The sentence for a problem on /train. An automated start refused with 422 no-coverage names the
 * scope, not a drill. A holdout start (onStart: the start panel is showing) refused with the
 * holdout-complete or no-holdout-items slug gets its own sentence, chosen by slug, never by the
 * bare status, so a 422 validation or a 409 idempotency conflict, and any problem of a running
 * retest, keeps the trainer's generic sentence.
 */
export function trainProblemMessage(mode: TrainMode, problem: SpotProblem, onStart: boolean): string {
  if (problem.kind === "no_coverage") return NO_CLASS_IN_SCOPE;
  const holdoutStart = mode === "holdout" && onStart && problem.slug !== undefined ? HOLDOUT_START_MESSAGES[problem.slug] : undefined;
  return holdoutStart ?? problemMessage(problem);
}
