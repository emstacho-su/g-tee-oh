/**
 * The per-browser saved spots of the study screen (S45, R3.27, O-460). Pure.
 *
 * A spot is the five settings that name a configuration and a pair (format, table size, stake,
 * depth, pair). The last spot and the recent list hold whole validated searches (the line, the
 * hand and the lens too, so returning restores the view); the starred list holds spots only.
 * Everything read from storage passes validateStudySearch, so a hand-edited or stale value is
 * dropped, never sent to the api, and an entry without all five settings is left out. The address
 * stays the source of truth: these lists only seed a bare /study and offer links. Server-side saved
 * spots with a note and tags are O-460 (a later session); the note will be an annotation, never
 * graded.
 */
import { isRecord } from "../store/guarded-storage.js";
import { validateStudySearch, type StudySearch } from "./search.js";
import { settingsSignature } from "./settings.js";

export const MAX_RECENT_SPOTS = 10;
export const MAX_STARRED_SPOTS = 50;

export type StudySpot = Required<Pick<StudySearch, "format" | "table_size" | "stake" | "depth" | "pair">>;

/** The spot a search names, or undefined when one of its five settings is missing. */
export function spotOf(search: StudySearch): StudySpot | undefined {
  const { format, table_size: tableSize, stake, depth, pair } = search;
  if (format === undefined || tableSize === undefined || stake === undefined || depth === undefined || pair === undefined) return undefined;
  return { format, table_size: tableSize, stake, depth, pair };
}

/** One entry per spot and line in the recent list. */
function recentKey(search: StudySearch): string {
  return `${settingsSignature(search)}|${search.line ?? ""}`;
}

/** A stored value as a complete, validated search, or null. */
function completeSearch(value: unknown): StudySearch | null {
  if (!isRecord(value)) return null;
  const search = validateStudySearch(value);
  return spotOf(search) === undefined ? null : search;
}

export function parseLastSpot(value: unknown): StudySearch | null {
  return completeSearch(value);
}

export function parseRecentSpots(value: unknown): StudySearch[] {
  if (!Array.isArray(value)) return [];
  return value.map(completeSearch).filter((search): search is StudySearch => search !== null).slice(0, MAX_RECENT_SPOTS);
}

export function parseStarredSpots(value: unknown): StudySpot[] {
  if (!Array.isArray(value)) return [];
  const spots = value.map(completeSearch).flatMap((search) => {
    const spot = search === null ? undefined : spotOf(search);
    return spot === undefined ? [] : [spot];
  });
  const unique = spots.filter((spot, index) => spots.findIndex((other) => settingsSignature(other) === settingsSignature(spot)) === index);
  return unique.slice(0, MAX_STARRED_SPOTS);
}

/** The recent list with this search first, its older entry for the same spot and line gone, ten at most. */
export function pushRecent(recent: readonly StudySearch[], search: StudySearch): StudySearch[] {
  if (spotOf(search) === undefined) return [...recent];
  const key = recentKey(search);
  return [search, ...recent.filter((entry) => recentKey(entry) !== key)].slice(0, MAX_RECENT_SPOTS);
}

export function isStarred(starred: readonly StudySpot[], search: StudySearch): boolean {
  const spot = spotOf(search);
  return spot !== undefined && starred.some((entry) => settingsSignature(entry) === settingsSignature(spot));
}

/** The starred list with the search's spot added first, or removed when it was there; fifty at most. */
export function toggleStar(starred: readonly StudySpot[], search: StudySearch): StudySpot[] {
  const spot = spotOf(search);
  if (spot === undefined) return [...starred];
  if (isStarred(starred, spot)) return starred.filter((entry) => settingsSignature(entry) !== settingsSignature(spot));
  return [spot, ...starred].slice(0, MAX_STARRED_SPOTS);
}
