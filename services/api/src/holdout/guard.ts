/**
 * The holdout guard (R4.13, O-276, 06 section 9): a holdout item is never served in a drill or an
 * automated hand. The global item set is read once per request, read only, so GET /next stays
 * write-free; deal-hand.ts asks the guard with the hero's row label at the dealt node and deals
 * again when it is held out. Study browsing is not filtered (O-276).
 */
import type { Database } from "../db.js";
import type { HoldoutGuard } from "../sessions/holdout-guard.js";
import { heldOutKeys } from "./repository.js";

const KEY_SEPARATOR = "|";

function keyOf(solutionId: string, nodeKey: string, hand: string): string {
  return [solutionId, nodeKey, hand].join(KEY_SEPARATOR);
}

/** A guard over the given item keys. */
export function holdoutGuardOf(items: readonly { solutionId: string; nodeKey: string; hand: string }[]): HoldoutGuard {
  const held = new Set(items.map((item) => keyOf(item.solutionId, item.nodeKey, item.hand)));
  return { isHeldOut: (solutionId, nodeKey, hand) => held.has(keyOf(solutionId, nodeKey, hand)) };
}

/** The guard over every stored holdout item. */
export async function loadHoldoutGuard(database: Database): Promise<HoldoutGuard> {
  return holdoutGuardOf(await heldOutKeys(database));
}
