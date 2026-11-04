/**
 * The builder's live status line (S47, R3.37, O-485, design rule 8): "Reaches N spots; K covered,
 * M not built yet." recomputed on every draft change from the two catalog reads (use-drill-reach),
 * so a drill that names a game the library has nothing for says so before Save, not after Start.
 * The counts are (configuration, pair) spots, the unit the api's own coverage uses (O-312); the
 * queue is not claimed, since only a start knows it.
 */
import type { DrillDraft } from "../../drills/draft.js";
import { pickedDepths } from "../../drills/config-picker-model.js";
import { REACH_TEXT, reachText, type ReachFilter } from "../../drills/reach-model.js";
import { useDrillReach } from "../../drills/use-drill-reach.js";

export const REACH_STATUS_TEXT = {
  ...REACH_TEXT,
  failed: "The catalog could not be read, so the spots this drill reaches are not counted.",
} as const;

/** The parts of a draft the reach depends on; a depth that does not parse is left out. */
export function reachFilterOf(draft: DrillDraft): ReachFilter {
  return {
    game_config: { format: draft.format, table_size: draft.tableSize, depths_bb: pickedDepths(draft) },
    stake: draft.stake,
    hero_positions: [...draft.heroPositions],
    villain_positions: [...draft.villainPositions],
  };
}

export function ReachStatus({ draft }: { draft: DrillDraft }) {
  const state = useDrillReach(reachFilterOf(draft));
  const text = state === undefined ? REACH_STATUS_TEXT.counting : state.failed === true ? REACH_STATUS_TEXT.failed : reachText(state.reach);
  return (
    <p role="status" data-testid="reach-status" className="text-sm font-medium">
      {text}
    </p>
  );
}
