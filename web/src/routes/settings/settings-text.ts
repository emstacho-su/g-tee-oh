/**
 * Fixed text of the S32 /settings sections (R4.12, R4.14, O-323, O-327). The grouping names are
 * kept here rather than read from the drill run's labels, which S26 moves to src/drills/labels.ts.
 */
import type { Grouping } from "../../contracts.js";

export const GROUPING_LABELS: Readonly<Record<Grouping, string>> = {
  standard: "Standard",
  grouped: "Grouped",
  simple: "Simple",
};

export const SESSION_DEFAULTS_TEXT = {
  title: "Session defaults",
  description: "The Train screen starts automated sessions with these choices. They are kept on this browser only.",
  grouping: "Grouping",
  scopeLegend: "Configurations",
  scopeAll: "All covered configurations",
  scopeChosen: "Only the configurations I choose",
  chooseList: "Configurations to train",
  noneChosen: "Choose at least one configuration. Until then, sessions use all covered configurations.",
  saved: "Saved on this browser.",
  loadingConfigs: "Loading the configurations.",
  configsFailed: "The configurations could not be loaded.",
  noConfigs: "No configurations are in the catalog yet.",
  removeStale: "Remove them",
} as const;

export function staleConfigsText(ids: readonly string[]): string {
  return `Saved configurations no longer offered: ${ids.join(", ")}.`;
}

export function scopeCapText(max: number): string {
  return `At most ${max} configurations can be chosen.`;
}

export const COSMETICS_TEXT = {
  title: "Cosmetics",
  note: "Cosmetics change only how the app looks; they never change training.",
  none: "None",
  noneHint: "The standard look",
  locked: "Locked",
  loading: "Loading your unlocks.",
  failed: "Your unlocks could not be loaded.",
} as const;

export const COSMETIC_SLOT_TITLES = {
  "card-back": "Card back",
  felt: "Table felt",
  badge: "Badge",
} as const;

export const HOTKEYS_TEXT = {
  title: "Hotkeys",
  description: "The keyboard shortcuts of the trainer and the app. Press ? on any screen to see the ones active there.",
  later: "Rebinding keys comes in a later version.",
  caption: "Keyboard shortcuts",
} as const;
