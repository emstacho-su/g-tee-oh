/**
 * The Study keyboard scope's keys and words (S45, R3.12, O-466). One source for the bindings
 * use-study-hotkeys registers, the ? overlay (which lists whatever is registered) and the read-only
 * table on /settings (hotkey-table.ts spreads STUDY_HOTKEY_ROWS), so the three always agree.
 *
 * No global binding uses these keys (the trainer, quiz and drill scopes mount only on their own
 * routes). The arrows and Escape yield to a control that already handled the key: the range matrix
 * grid and the segmented controls prevent the arrows they use, and dispatch skips a prevented key.
 * Rebinding stays deferred (O-327).
 */
import { displayKey } from "../hotkeys/index.js";

export const STUDY_SCOPE = "Study";

export const STUDY_KEYS = {
  back: "ArrowLeft",
  next: "ArrowRight",
  root: "Home",
  deeper: "ArrowUp",
  shallower: "ArrowDown",
  mode: "m",
  settings: "s",
  clearFilters: "Escape",
} as const;

export const STUDY_KEY_TEXT = {
  back: "Back one decision",
  next: "Follow the next likely action",
  root: "Back to the start of this spot",
  deeper: "The next deeper covered depth at this line",
  shallower: "The next shallower covered depth at this line",
  mode: "Cycle the matrix lens",
  settings: "Open the spot settings",
  clearFilters: "Clear the action filters",
} as const;

export type StudyKeyName = keyof typeof STUDY_KEYS;

const ROW_ORDER: readonly StudyKeyName[] = ["back", "next", "root", "deeper", "shallower", "mode", "settings", "clearFilters"];

export interface StudyHotkeyRow {
  readonly key: string;
  readonly action: string;
  readonly scope: string;
}

export const STUDY_HOTKEY_ROWS: readonly StudyHotkeyRow[] = ROW_ORDER.map((name) => ({
  key: displayKey(STUDY_KEYS[name]),
  action: STUDY_KEY_TEXT[name],
  scope: STUDY_SCOPE,
}));
