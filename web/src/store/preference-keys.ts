/**
 * The localStorage keys of the per-browser preferences (S32, O-323). Kept apart from the stores, as
 * theme-key.ts is, so the Playwright shots can seed them in an init script without loading zustand.
 */
export const COSMETICS_STORAGE_KEY = "gto-cosmetics";
export const SESSION_DEFAULTS_STORAGE_KEY = "gto-session-defaults";
/** S45 (R3.27, O-460): the last confirmed study spot, the seed of a bare /study. */
export const STUDY_LAST_SPOT_STORAGE_KEY = "gto-study-last-spot";
/** S45 (R3.27): the starred study spots, at most fifty. */
export const STUDY_STARRED_STORAGE_KEY = "gto-study-starred";
/** S45 (R3.27): the last ten confirmed study searches. */
export const STUDY_RECENT_STORAGE_KEY = "gto-study-recent";
