/**
 * The drill routes' search parameters (S26, R3.14, O-286). The router keeps every value the
 * string in the URL (app/search-serialization.ts) and merges a parent's search into a child's, so
 * each route component passes its screen only what these validators return.
 * - /drills: tag, the library's tag filter, kept only when it is a valid tag (TAG_PATTERN), so a
 *   hand-edited URL never reaches GET /drills as a 400.
 * - /drills/$id: saved=1 after the builder created the drill, so the new drill's page says so;
 *   saved=rerun after a Save and run whose drill was edited again while the save was in flight
 *   (S47, PR #48 review MEDIUM 6), so the page says to save again before running.
 */
import { TAG_PATTERN } from "./limits.js";

export interface DrillsSearch {
  tag?: string;
}

export const SAVED_FLAGS = ["1", "rerun"] as const;
export type SavedFlag = (typeof SAVED_FLAGS)[number];

export interface DrillBuilderSearch {
  saved?: SavedFlag;
}

export function validateDrillsSearch(search: Record<string, unknown>): DrillsSearch {
  const tag = search["tag"];
  return typeof tag === "string" && TAG_PATTERN.test(tag) ? { tag } : {};
}

export function validateDrillBuilderSearch(search: Record<string, unknown>): DrillBuilderSearch {
  const saved = SAVED_FLAGS.find((flag) => flag === search["saved"]);
  return saved === undefined ? {} : { saved };
}
