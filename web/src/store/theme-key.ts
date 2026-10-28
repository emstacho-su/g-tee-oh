/**
 * The localStorage key of the chosen theme (R3.13, O-266), in a module with no side effects, so
 * Node code such as the Playwright shot helpers can import it without creating the theme store,
 * which reads window at import time (S25).
 */
export const THEME_STORAGE_KEY = "gto-theme";
