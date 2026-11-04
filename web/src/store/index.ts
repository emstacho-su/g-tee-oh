/** Zustand stores for the trainer shell (R3.13): table state, panel toggles and theme. */
export { createPanelStore, PANEL_KEYS, usePanelStore } from "./panels.js";
export type { PanelMap, PanelState } from "./panels.js";
export { applyThemeClass, createThemeStore, THEME_STORAGE_KEY, useThemeStore } from "./theme.js";
export type { Theme, ThemeEnvironment, ThemeState } from "./theme.js";
export { createTrainerTableStore, useTrainerTableStore } from "./trainer-table.js";
export type { TrainerTableState } from "./trainer-table.js";
// S32 (O-323): equipped cosmetics and automated session defaults, both per browser.
export {
  COSMETIC_SLOTS,
  COSMETICS_STORAGE_KEY,
  createCosmeticsStore,
  effectiveCosmetics,
  hasAnyChoice,
  NO_COSMETICS,
  parseCosmeticChoices,
  useCosmeticsStore,
} from "./cosmetics.js";
export type { CosmeticChoices, CosmeticsEnvironment, CosmeticsState } from "./cosmetics.js";
export {
  ALL_CONFIGS,
  CONFIG_ID_PATTERN,
  createSessionDefaultsStore,
  DEFAULT_SESSION_DEFAULTS,
  GROUPINGS,
  isConfigScope,
  MAX_SCOPE_CONFIGS,
  MIN_SCOPE_CONFIGS,
  parseSessionDefaults,
  SCOPE_MODES,
  SESSION_DEFAULTS_STORAGE_KEY,
  useSessionDefaultsStore,
} from "./session-defaults.js";
export type { ConfigScope, ScopeMode, SessionDefaults, SessionDefaultsEnvironment, SessionDefaultsState } from "./session-defaults.js";
// S47 (O-486): the last label of each chosen configuration, for a scope the catalog no longer lists.
export { CONFIG_LABELS_STORAGE_KEY } from "./preference-keys.js";
export { parseConfigLabels, readConfigLabels, rememberConfigLabels, withConfigLabels } from "./config-labels.js";
export type { ConfigLabels } from "./config-labels.js";
