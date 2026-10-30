/**
 * The localStorage keys of the per-browser preferences (S32, O-323). Kept apart from the stores, as
 * theme-key.ts is, so the Playwright shots can seed them in an init script without loading zustand.
 */
export const COSMETICS_STORAGE_KEY = "gto-cosmetics";
export const SESSION_DEFAULTS_STORAGE_KEY = "gto-session-defaults";
/** The last label seen for each chosen configuration (S47, O-486). */
export const CONFIG_LABELS_STORAGE_KEY = "gto-config-labels";
