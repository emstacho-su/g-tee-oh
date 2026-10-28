/**
 * The drill routes' search parameters (S26, R3.14, O-286). The router keeps every value the
 * string in the URL (app/search-serialization.ts) and merges a parent's search into a child's, so
 * each route component passes its screen only what these validators return.
 * - /drills: tag, the library's tag filter, kept only when it is a valid tag (TAG_PATTERN), so a
 *   hand-edited URL never reaches GET /drills as a 400.
 * - /drills/$id: saved=1 after the builder created the drill, so the new drill's page says so.
 */
import { TAG_PATTERN } from "./limits.js";

export interface DrillsSearch {
  tag?: string;
}

export interface DrillBuilderSearch {
  saved?: "1";
}

export function validateDrillsSearch(search: Record<string, unknown>): DrillsSearch {
  const tag = search["tag"];
  return typeof tag === "string" && TAG_PATTERN.test(tag) ? { tag } : {};
}

export function validateDrillBuilderSearch(search: Record<string, unknown>): DrillBuilderSearch {
  return search["saved"] === "1" ? { saved: "1" } : {};
}
