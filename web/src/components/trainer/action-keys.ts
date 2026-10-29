/**
 * The trainer's key map by action kind (S46, R3.30, design rule 9, O-475). Pure.
 *
 * One fixed letter per kind that has no size: F fold, C call, X check (the solver's own token for
 * a check), A all-in, L limp; a straddle has no key. The bet and raise sizes take the digits 1 to
 * 9 in bar order, so 1 is always the smallest size at the node whatever stands before it, and no
 * key moves with the number of buttons. The letters avoid N and Enter (next hand), Shift+E (end),
 * Shift+S (study), I (the explainer), R (reserved for repeat hand) and ? (the overlay).
 */
import type { ActionKind, NodeAction } from "../../contracts.js";

/** The kinds that have a letter. */
export type LetteredKind = Extract<ActionKind, "fold" | "call" | "check" | "all_in" | "limp">;

export const KIND_KEYS: Readonly<Record<LetteredKind, string>> = {
  fold: "f",
  call: "c",
  check: "x",
  all_in: "a",
  limp: "l",
};

function letterOf(kind: ActionKind): string | undefined {
  return kind in KIND_KEYS ? KIND_KEYS[kind as LetteredKind] : undefined;
}

/** The kinds the digits number, in bar order. */
export const SIZE_KINDS: readonly ActionKind[] = ["bet", "raise"];

/** Digits 1 to 9 number the first nine sizes. */
export const MAX_SIZE_HOTKEYS = 9;

/** What the /settings table calls each lettered kind. */
export const KIND_KEY_NAMES: Readonly<Record<LetteredKind, string>> = {
  fold: "Fold",
  call: "Call",
  check: "Check",
  all_in: "All-in",
  limp: "Limp",
};

/** The key per button position: the kind's letter, the size's digit, or null for none. */
export function actionHotkeys(actions: readonly NodeAction[]): (string | null)[] {
  const keys: (string | null)[] = [];
  let sizes = 0;
  for (const action of actions) {
    const letter = letterOf(action.kind);
    if (letter !== undefined) {
      keys.push(letter);
    } else if (SIZE_KINDS.includes(action.kind)) {
      sizes += 1;
      keys.push(sizes <= MAX_SIZE_HOTKEYS ? String(sizes) : null);
    } else {
      keys.push(null);
    }
  }
  return keys;
}
