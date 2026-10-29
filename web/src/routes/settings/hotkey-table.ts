/**
 * The read-only hotkey table of /settings (S32, S46, O-327, O-285, R3.30, A7 section 4): the
 * trainer and app shortcuts, each with its key, what it does and where it works.
 *
 * Mechanism: the keys, descriptions and scopes come from the constants the components register
 * with useHotkey (the action key map, the drill run labels, the Mixed-frequency mode explainer
 * hook, the reserved keys and the hotkey registry), so this table and the ? overlay agree. S46:
 * one fixed letter per action kind, digits for the sizes in bar order, Enter beside N, Shift+E
 * for End, Shift+S for Study and R reserved (design rule 9, O-473 to O-475). The S and U keys
 * left with the confidence tap (O-345). Rebinding is deferred (O-327).
 */
import { ACTION_SCOPE, MAX_HOTKEY_ACTIONS } from "../../components/trainer/index.js";
import { KIND_KEYS, KIND_KEY_NAMES, type LetteredKind } from "../../components/trainer/action-keys.js";
import { RNG_EXPLAINER_KEY, RNG_EXPLAINER_SCOPE, RNG_EXPLAINER_TITLE } from "../../components/trainer/use-rng-explainer.js";
import { displayBinding, displayKey, GENERAL_SCOPE, RESERVED_KEYS, SHORTCUTS_DESCRIPTION, SHORTCUTS_KEY } from "../../hotkeys/index.js";
import { END_SESSION_BINDING, NEXT_HAND_ENTER_KEY, NEXT_HAND_KEY, SESSION_SCOPE, SESSION_TEXT, STUDY_SPOT_BINDING } from "../drill-run/labels.js";

const FIRST_SIZE_KEY = 1;

export interface HotkeyRow {
  readonly key: string;
  readonly action: string;
  readonly scope: string;
}

const KIND_ROWS: readonly HotkeyRow[] = (Object.entries(KIND_KEYS) as [LetteredKind, string][]).map(([kind, key]) => ({
  key: displayKey(key),
  action: `Choose ${KIND_KEY_NAMES[kind]} and submit it`,
  scope: ACTION_SCOPE,
}));

const RESERVED_ROWS: readonly HotkeyRow[] = RESERVED_KEYS.map((reserved) => ({
  key: displayKey(reserved.key),
  action: `Reserved: ${reserved.description}`,
  scope: reserved.scope,
}));

export const HOTKEY_ROWS: readonly HotkeyRow[] = [
  ...KIND_ROWS,
  {
    key: `${FIRST_SIZE_KEY} to ${MAX_HOTKEY_ACTIONS}`,
    action: "Choose a bet or raise size and submit it, in the order the action bar shows the sizes",
    scope: ACTION_SCOPE,
  },
  { key: `${NEXT_HAND_KEY} or ${NEXT_HAND_ENTER_KEY}`, action: SESSION_TEXT.nextHand, scope: SESSION_SCOPE },
  { key: displayBinding(END_SESSION_BINDING), action: SESSION_TEXT.endSession, scope: SESSION_SCOPE },
  { key: displayBinding(STUDY_SPOT_BINDING), action: `${SESSION_TEXT.studySpot} in a new tab`, scope: SESSION_SCOPE },
  ...RESERVED_ROWS,
  { key: displayKey(RNG_EXPLAINER_KEY), action: RNG_EXPLAINER_TITLE, scope: RNG_EXPLAINER_SCOPE },
  { key: SHORTCUTS_KEY, action: SHORTCUTS_DESCRIPTION, scope: GENERAL_SCOPE },
];
