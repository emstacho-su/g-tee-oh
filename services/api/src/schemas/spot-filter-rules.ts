/**
 * Cross-field rules of the drill spot filter (R3.14, PR #20 review M4), checked at the boundary so
 * a drill that can never produce a spot is a 400, not a silent empty drill later.
 *
 * - Every hero and villain position is seated at game_config.table_size, by the seat lists pinned
 *   from gto-model's Position::seated (catalog/seats.ts, O-234); a six-max drill cannot ask for LJ.
 * - Hero and villain positions are disjoint: a seat cannot play against itself.
 * - The stake label matches the format (ADR 0014): online drills use the one online rake profile,
 *   labelled online; live drills name a live stake as small/big blind, such as 1/3 or 2/5.
 * - No list repeats a value: depths, positions, preflop actions and manually chosen hands.
 *
 * Each violation is reported at the path of the offending element, so the 400 problem's errors
 * list points the client at the exact entry. The base shape is validated first; these rules run
 * only on a filter that already has the right shape.
 */
import type { z } from "zod";

import { seatedPositions } from "../catalog/seats.js";

export const ONLINE_STAKE_LABEL = "online";
export const LIVE_STAKE_LABEL_PATTERN = /^[0-9]+\/[0-9]+$/;

interface SpotFilterShape {
  game_config: { format: "online" | "live"; table_size: number; depths_bb: readonly number[] };
  stake: string;
  hero_positions: readonly string[];
  villain_positions: readonly string[];
  preflop_action: readonly string[];
  hands: { mode: string; hands?: readonly string[] };
}

type Path = ReadonlyArray<string | number>;

function report(context: z.RefinementCtx, path: Path, message: string): void {
  context.addIssue({ code: "custom", path: [...path], message });
}

function reportDuplicates(context: z.RefinementCtx, values: readonly unknown[], path: Path): void {
  values.forEach((value, index) => {
    if (values.indexOf(value) !== index) {
      report(context, [...path, index], `${String(value)} is listed more than once`);
    }
  });
}

function reportUnseated(context: z.RefinementCtx, filter: SpotFilterShape): void {
  const seated: readonly string[] = seatedPositions(filter.game_config.table_size);
  const size = filter.game_config.table_size;
  for (const field of ["hero_positions", "villain_positions"] as const) {
    filter[field].forEach((position, index) => {
      if (!seated.includes(position)) {
        report(context, [field, index], `${position} is not seated at a ${size}-handed table`);
      }
    });
  }
}

function reportOverlap(context: z.RefinementCtx, filter: SpotFilterShape): void {
  filter.villain_positions.forEach((position, index) => {
    if (filter.hero_positions.includes(position)) {
      report(context, ["villain_positions", index], `${position} is also a hero position`);
    }
  });
}

function reportStakeMismatch(context: z.RefinementCtx, filter: SpotFilterShape): void {
  const online = filter.game_config.format === "online";
  const matches = online ? filter.stake === ONLINE_STAKE_LABEL : LIVE_STAKE_LABEL_PATTERN.test(filter.stake);
  if (!matches) {
    const expected = online ? `"${ONLINE_STAKE_LABEL}"` : "a live stake such as 1/3";
    report(context, ["stake"], `a ${filter.game_config.format} drill needs ${expected}`);
  }
}

/** The superRefine body of spotFilterSchema. */
export function checkSpotFilter(filter: SpotFilterShape, context: z.RefinementCtx): void {
  reportUnseated(context, filter);
  reportOverlap(context, filter);
  reportStakeMismatch(context, filter);
  reportDuplicates(context, filter.game_config.depths_bb, ["game_config", "depths_bb"]);
  reportDuplicates(context, filter.hero_positions, ["hero_positions"]);
  reportDuplicates(context, filter.villain_positions, ["villain_positions"]);
  reportDuplicates(context, filter.preflop_action, ["preflop_action"]);
  if (filter.hands.hands !== undefined) {
    reportDuplicates(context, filter.hands.hands, ["hands", "hands"]);
  }
}
