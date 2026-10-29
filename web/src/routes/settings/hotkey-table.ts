/**
 * The read-only hotkey table of /settings (S32, O-327, O-285, A7 section 4): the trainer and app
 * shortcuts, each with its key, what it does and where it works.
 *
 * Mechanism: the keys, descriptions and scopes come from the constants the components register
 * with useHotkey (ActionBar, the drill run labels, the Mixed-frequency mode explainer hook and
 * the hotkey registry), so this table and the ? overlay agree. The S and U keys left with the
 * confidence tap (O-345). Rebinding is deferred (O-327).
 */
import { ACTION_SCOPE, MAX_HOTKEY_ACTIONS } from "../../components/trainer/index.js";
import { RNG_EXPLAINER_KEY, RNG_EXPLAINER_SCOPE, RNG_EXPLAINER_TITLE } from "../../components/trainer/use-rng-explainer.js";
import { displayKey, GENERAL_SCOPE, SHORTCUTS_DESCRIPTION, SHORTCUTS_KEY } from "../../hotkeys/index.js";
import { END_SESSION_KEY, NEXT_HAND_KEY, SESSION_SCOPE, SESSION_TEXT } from "../drill-run/labels.js";
import { STUDY_HOTKEY_ROWS } from "../../study/study-hotkeys.js";

const FIRST_ACTION_KEY = 1;

export interface HotkeyRow {
  readonly key: string;
  readonly action: string;
  readonly scope: string;
}

export const HOTKEY_ROWS: readonly HotkeyRow[] = [
  { key: `${FIRST_ACTION_KEY} to ${MAX_HOTKEY_ACTIONS}`, action: "Choose an action and submit it, in the order the action bar shows them", scope: ACTION_SCOPE },
  { key: NEXT_HAND_KEY, action: SESSION_TEXT.nextHand, scope: SESSION_SCOPE },
  { key: END_SESSION_KEY, action: SESSION_TEXT.endSession, scope: SESSION_SCOPE },
  { key: displayKey(RNG_EXPLAINER_KEY), action: RNG_EXPLAINER_TITLE, scope: RNG_EXPLAINER_SCOPE },
  { key: SHORTCUTS_KEY, action: SHORTCUTS_DESCRIPTION, scope: GENERAL_SCOPE },
  ...STUDY_HOTKEY_ROWS,
];
