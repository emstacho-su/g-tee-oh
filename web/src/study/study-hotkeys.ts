/**
 * The Study keyboard scope's keys and words (S45, R3.12, O-466). One source for the bindings
 * use-study-hotkeys registers, the ? overlay (which lists whatever is registered) and the read-only
 * table on /settings (hotkey-table.ts spreads STUDY_HOTKEY_ROWS), so the three always agree.
 *
 * No binding in any scope uses these keys: the app-wide ? opens the overlay, and the trainer (1 to
 * 9, N, E, I), quiz (Enter, N) and painter (digits) scopes mount only on their own routes. ArrowUp,
 * ArrowDown and Home stay the browser's for scrolling (code review): depth steps are ] and [, and
 * the root is R (O-466 as amended). ArrowLeft, ArrowRight and Escape yield to a control that
 * already handled the key (the range matrix grid prevents its arrows and its pop-out's Escape, Radix
 * segmented controls their arrows), because dispatch skips a prevented key. Rebinding stays
 * deferred (O-327).
 */
import { displayKey } from "../hotkeys/index.js";

export const STUDY_SCOPE = "Study";

export const STUDY_KEYS = {
  back: "ArrowLeft",
  next: "ArrowRight",
  root: "r",
  deeper: "]",
  shallower: "[",
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
