/**
 * The /library search parameters (S28, R3.4, O-286). The URL is the coverage view's state: the
 * configuration filters and the selected pair, the same five keys the study browser uses.
 *
 * Mechanism: the router keeps every value a string and merges a parent's search into a child's
 * (S25), so the route component passes the screen only what validateLibrarySearch returns. It
 * runs the study validator, which holds the contract's patterns, and keeps the library's keys, so
 * a stray ?line= or ?hand= never reaches this screen. withLibraryFilter applies one filter change
 * through the study rule (a change clears the filters below it) and withPair selects a pair.
 */
import { withFilter, type FilterKey } from "../study/filters.js";
import { validateStudySearch, type StudySearch } from "../study/search.js";

export type LibrarySearch = Pick<StudySearch, "format" | "table_size" | "stake" | "depth" | "pair">;

const LIBRARY_KEYS: readonly (keyof LibrarySearch)[] = ["format", "table_size", "stake", "depth", "pair"];

function libraryPart(search: StudySearch): LibrarySearch {
  const kept: LibrarySearch = Object.fromEntries(
    LIBRARY_KEYS.filter((key) => search[key] !== undefined).map((key) => [key, search[key]]),
  );
  return kept;
}

/** The valid library parameters of a URL; anything else is dropped. */
export function validateLibrarySearch(search: Record<string, unknown>): LibrarySearch {
  return libraryPart(validateStudySearch(search));
}

/** The search after a filter select changes to raw ("" clears it and the filters below). */
export function withLibraryFilter(search: LibrarySearch, key: FilterKey, raw: string): LibrarySearch {
  return libraryPart(withFilter(search, key, raw));
}

/** The search with another pair selected; an invalid pair is dropped. */
export function withPair(search: LibrarySearch, pair: string): LibrarySearch {
  return validateLibrarySearch({ ...search, pair });
}
