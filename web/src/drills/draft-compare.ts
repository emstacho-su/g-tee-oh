/**
 * Whether two builder drafts hold the same edits (S40, R3.14, O-405, PR #42 review round 1 F). The
 * leave guard and the Save baseline compare drafts by meaning, not by their JSON text: object keys
 * may come in any order (an edit rebuilds an object with its own key order), and a panel turned on
 * and off again reads as off, so undoing an edit always makes the draft clean again. Pure.
 */
import type { DrillDraft } from "./draft.js";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural equality of plain data, independent of object key order. */
export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((entry, index) => deepEqual(entry, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
}

/** The draft with every panel that is off left out: an absent panel key already counts as off. */
function withPanelsOn(draft: DrillDraft): DrillDraft {
  const panels = Object.fromEntries(Object.entries(draft.trainer.panels).filter(([, on]) => on === true));
  return { ...draft, trainer: { ...draft.trainer, panels } };
}

export function draftsEqual(left: DrillDraft, right: DrillDraft): boolean {
  return deepEqual(withPanelsOn(left), withPanelsOn(right));
}
