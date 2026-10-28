/**
 * The /train search parameters (S32, R4.10, O-328): mode=holdout opens the monthly holdout retest;
 * anything else, including no mode, is automated training. Values arrive as strings
 * (app/search-serialization.ts), and only the exact string "holdout" is kept; every other key is
 * dropped. The route component validates again, since the router merges a parent's raw search into
 * its children (router.tsx, the /study note).
 */
import type { TrainMode } from "./train-text.js";

export interface TrainSearch {
  mode?: "holdout";
}

export function validateTrainSearch(search: Record<string, unknown>): TrainSearch {
  return search["mode"] === "holdout" ? { mode: "holdout" } : {};
}

export function trainModeOf(search: TrainSearch): TrainMode {
  return search.mode === "holdout" ? "holdout" : "automated";
}
