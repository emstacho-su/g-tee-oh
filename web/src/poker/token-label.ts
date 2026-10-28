/**
 * The plain name of an action token (S38, R3.12, ADR 0004, screen review row 14). Pure.
 *
 * Mechanism: a token is gto-model's ActionToken text: one letter (f fold, x check, c call, l limp,
 * a all-in) or a sized letter followed by the size in centi-big-blinds with no leading zero
 * (s straddle, b bet, r raise; "r250" is a raise of 2.5bb). The name follows exactActionLabel's
 * form ("Raise 2.5bb"), so an action named from its token reads the same as one named from the
 * node. Anything else returns null, never a guess. Naming only: no size is computed.
 */
import type { ActionKind } from "../contracts.js";
import { actionStyle } from "../theme/action-style.js";
import { formatCbb } from "./format.js";

const UNSIZED: ReadonlyMap<string, ActionKind> = new Map<string, ActionKind>([
  ["f", "fold"],
  ["x", "check"],
  ["c", "call"],
  ["l", "limp"],
  ["a", "all_in"],
]);
const SIZED: ReadonlyMap<string, ActionKind> = new Map<string, ActionKind>([
  ["s", "straddle"],
  ["b", "bet"],
  ["r", "raise"],
]);
const SIZED_TOKEN = /^([sbr])([1-9][0-9]*)$/;

/** "Raise 2.5bb" for "r250", "Fold" for "f"; null for text that is not a token. */
export function tokenActionLabel(token: string): string | null {
  const unsized = UNSIZED.get(token);
  if (unsized !== undefined) return actionStyle(unsized).name;
  const match = SIZED_TOKEN.exec(token);
  const kind = match?.[1] === undefined ? undefined : SIZED.get(match[1]);
  if (kind === undefined || match?.[2] === undefined) return null;
  return `${actionStyle(kind).name} ${formatCbb(Number(match[2]))}`;
}
