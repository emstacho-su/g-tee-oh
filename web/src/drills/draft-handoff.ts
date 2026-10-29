/**
 * Carrying unsaved builder edits from a new drill to its stored builder (S40, R3.14, O-405, PR #42
 * review round 1 B). When a create succeeds while the player kept editing, the builder moves to
 * /drills/<new id>/<page>, where a fresh form for the stored drill mounts. Before that move the new
 * drill's form hands its current draft over here, keyed by the new id; the stored drill's builder
 * starts from it (the stored drill stays the saved baseline), so the in-flight edits are kept as
 * unsaved changes and the next Save patches the new drill instead of creating another.
 *
 * Mechanism: one map for the page's lifetime, read with peek at mount and cleared after it, so a
 * draft is used by exactly the builder it was handed to. Nothing here outlives a reload.
 */
import type { DrillDraft } from "./draft.js";

const handed = new Map<string, DrillDraft>();

export function handOffDraft(drillId: string, draft: DrillDraft): void {
  handed.set(drillId, draft);
}

/** The draft handed to this drill's builder, if any; it stays until clearHandedDraft. */
export function peekHandedDraft(drillId: string): DrillDraft | undefined {
  return handed.get(drillId);
}

export function clearHandedDraft(drillId: string): void {
  handed.delete(drillId);
}
