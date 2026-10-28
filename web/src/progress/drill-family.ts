/**
 * From a heat map cell's coordinates to a drill body (S32, R4.12, O-321 as amended by the PM,
 * ADR 0004). Pure.
 *
 * Mechanism:
 * - Family: the cell's family is one of gto-model's action families; DRILL_ACTION_FOR_FAMILY picks
 *   the drill preflop_action that the api's DRILL_FAMILY_TABLE (services/api/src/sessions/
 *   action-family.ts) maps back to that family alone where one exists: rfi, vs_open,
 *   vs_three_bet, squeeze, limp_iso and straddle each accept exactly one family; four_bet is the
 *   only drill family that accepts facing-4bet. The api lets blind-vs-blind satisfy every drill
 *   family, so it takes rfi: at the SB-BB pair every line is blind versus blind anyway. A drift
 *   test reads that api file as text and fails when a Rust family loses its drill family.
 * - Pair: written out-of-position seat first (crates/gto-model/src/spot_class.rs, "BB-BTN"). The
 *   filter takes both seats as hero positions and leaves villain positions empty (any opponent).
 *   This is an approximation: the family narrows who acts, but a seat of the pair can also meet
 *   that family against a third seat, so the drill may deal some spots of the same family outside
 *   the exact pair. A tighter filter needs a per-family hero seat rule the api does not publish,
 *   so the approximation stands until it does.
 * - Game: the format comes from the column; the table size, stake and depths come from GET
 *   /configs. A config matches when its format is the column's, its depth_cbb falls in the
 *   column's depth band (DEPTH_BAND_EDGES_CBB, copied from DepthBand::EDGES_CBB with a drift
 *   test), and its table seats both pair positions (S26's seatedPositions, src/drills/limits.ts).
 *   The first match in /configs order fixes the table size and stake; every match with that table
 *   size and stake adds its depth in bb (at most the schema's MAX_DEPTHS).
 * - The rest: sizing convention, start street preflop, every hand, no seat alternation, and the
 *   drill builder's default trainer settings (S26's DEFAULT_TRAINER).
 * No match gives null and the caller creates nothing.
 */
import { DEFAULT_TRAINER } from "../drills/draft.js";
import { MAX_DEPTHS, seatedPositions } from "../drills/limits.js";
import type { DrillCreate, Position, PreflopAction, SpotFilter } from "../drills/types.js";
import type { GameConfig } from "./types.js";

/** gto-model's action family (ActionFamily::as_str) to the drill family that trains it. */
export const DRILL_ACTION_FOR_FAMILY: Readonly<Record<string, PreflopAction>> = {
  rfi: "rfi",
  "facing-open": "vs_open",
  "facing-3bet": "vs_three_bet",
  "facing-4bet": "four_bet",
  squeeze: "squeeze",
  "blind-vs-blind": "rfi",
  "limped-isolation": "limp_iso",
  "straddled-pot": "straddle",
};

/** DepthBand::EDGES_CBB: the lower edges (inclusive) of every band after short. */
export const DEPTH_BAND_EDGES_CBB = [5_000, 12_500, 17_500, 25_000] as const;
/** DepthBand::as_str, shallowest first. */
export const DEPTH_BANDS = ["short", "100", "150", "200", "deep"] as const;
export type DepthBand = (typeof DEPTH_BANDS)[number];

/** The largest table, whose seats include every position. */
const FULL_RING = 9;
const PAIR_SEPARATOR = "-";
const CBB_PER_BB = 100;
const FORMATS: readonly GameConfig["format"][] = ["online", "live"];

/** The coordinates of a class, as the heat map row and column give them. */
export interface DrillSpot {
  readonly family: string;
  readonly pair: string;
  readonly format: string;
  readonly depthBand: string;
}

export function depthBandOf(depthCbb: number): DepthBand {
  const passed = DEPTH_BAND_EDGES_CBB.filter((edge) => depthCbb >= edge).length;
  return DEPTH_BANDS[passed] ?? "deep";
}

function isPosition(value: string): value is Position {
  return (seatedPositions(FULL_RING) as readonly string[]).includes(value);
}

export function isDrillFormat(value: string): value is GameConfig["format"] {
  return (FORMATS as readonly string[]).includes(value);
}

/** The two seats of a pair written "OOP-IP", or null when it is not two known, different seats. */
export function pairSeats(pair: string): readonly [Position, Position] | null {
  const parts = pair.split(PAIR_SEPARATOR);
  const [oop, ip] = parts;
  if (parts.length !== 2 || oop === undefined || ip === undefined || oop === ip) return null;
  return isPosition(oop) && isPosition(ip) ? [oop, ip] : null;
}

function seatsBoth(config: GameConfig, seats: readonly Position[]): boolean {
  const seated = seatedPositions(config.table_size);
  return seats.every((seat) => seated.includes(seat));
}

/** The configs a spot can be drilled at: the first match's table size and stake, every depth. */
export function matchingConfigs(spot: DrillSpot, configs: readonly GameConfig[]): GameConfig[] {
  const seats = pairSeats(spot.pair);
  if (seats === null) return [];
  const matches = configs.filter(
    (config) => config.format === spot.format && depthBandOf(config.depth_cbb) === spot.depthBand && seatsBoth(config, seats),
  );
  const first = matches[0];
  if (first === undefined) return [];
  return matches.filter((config) => config.table_size === first.table_size && config.stake_label === first.stake_label);
}

function depthsInBb(configs: readonly GameConfig[]): number[] {
  return [...new Set(configs.map((config) => Math.round(config.depth_cbb / CBB_PER_BB)))].slice(0, MAX_DEPTHS);
}

/** The spot filter for a class, or null when its family or pair is unknown or no config matches. */
export function spotFilterFor(spot: DrillSpot, configs: readonly GameConfig[]): SpotFilter | null {
  const action = DRILL_ACTION_FOR_FAMILY[spot.family];
  const seats = pairSeats(spot.pair);
  const matches = matchingConfigs(spot, configs);
  const first = matches[0];
  if (action === undefined || seats === null || first === undefined) return null;
  return {
    game_config: { format: first.format, table_size: first.table_size, depths_bb: depthsInBb(matches) },
    stake: first.stake_label,
    sizing: { mode: "convention" },
    start_street: "preflop",
    hero_positions: [...seats],
    villain_positions: [],
    preflop_action: [action],
    hands: { mode: "all" },
    alternate_seats: false,
  };
}

export function leakDrillName(spot: DrillSpot): string {
  return `Leak drill: ${spot.family} ${spot.pair} ${spot.format} ${spot.depthBand}`;
}

/** The whole create body for a class's auto drill, or null when no config matches. */
export function leakDrillBody(spot: DrillSpot, tag: string, configs: readonly GameConfig[]): DrillCreate | null {
  const filter = spotFilterFor(spot, configs);
  return filter === null ? null : { name: leakDrillName(spot), tags: [tag], spot_filter: filter, trainer: DEFAULT_TRAINER };
}
