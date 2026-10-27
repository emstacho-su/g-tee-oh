/** Zustand stores for the trainer shell (R3.13): table state, panel toggles and theme. */
export { createPanelStore, PANEL_KEYS, usePanelStore } from "./panels.js";
export type { PanelMap, PanelState } from "./panels.js";
export { applyThemeClass, createThemeStore, THEME_STORAGE_KEY, useThemeStore } from "./theme.js";
export type { Theme, ThemeEnvironment, ThemeState } from "./theme.js";
export { createTrainerTableStore, useTrainerTableStore } from "./trainer-table.js";
export type { TrainerTableState } from "./trainer-table.js";
