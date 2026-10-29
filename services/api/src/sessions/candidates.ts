/**
 * The spots a drill draws from (R3.6, 05 sections 1 and 4, ADR 0018, O-249, O-234).
 *
 * Mechanism: a drill's spot_filter is expanded into (configuration, position pair) candidates:
 * - configurations: the catalog game_config rows of the filter's format and table size at one of
 *   its depths (big blinds times CBB_PER_BB, the catalog's centi-big-blind unit), under the stake
 *   the filter names by label, with no ante (ante variants are not served in v1, O-33);
 * - pairs: every hero position against every villain position (every other seat at the table when
 *   the villain list is empty), written out of position first (catalog/seats.ts, O-234).
 * Each candidate is then asked of solver-query's /v1/coverage; only pairs with a preflop solution
 * are kept, and the rest are returned as gaps, which the caller records as coverage_request rows
 * so the drill runs on its covered part and the builder learns what is missing (05 section 1).
 * Candidates are sorted, so a seed picks the same spot whatever order the database returns.
 */
import { canonicalPair, seatedPositions, type Position } from "../catalog/seats.js";
import type { Database } from "../db.js";
import type { SpotFilter } from "../schemas/drills.js";
import type { SolverPort } from "./solver-port.js";
import { mapBounded, MAX_CONCURRENT_SOLVER_CALLS } from "./concurrency.js";

/** Centi-big-blinds per big blind: the catalog stores depths in cbb (A4 section 1). */
export const CBB_PER_BB = 100;
/** v1 serves no ante variant (O-33); the drill and catalog-spot starts both read this. */
export const NO_ANTE_CBB = 0;

/** A (configuration, pair) a drill reaches, before its seats are searched (spot-search.ts). */
export interface PairCandidate {
  config_id: string;
  pair: string;
}

export interface CandidateSplit {
  covered: PairCandidate[];
  gaps: PairCandidate[];
}

type DrillSpotFilter = Pick<SpotFilter, "game_config" | "stake" | "hero_positions" | "villain_positions">;

/** A catalog configuration as the matching rule reads it: the game_config row joined to its stake's label. */
export interface CatalogConfigRow {
  config_id: string;
  format: SpotFilter["game_config"]["format"];
  table_size: number;
  stake_label: string;
  depth_cbb: number;
  ante_cbb: number;
}

/**
 * The configuration rule of a drill (S47, R3.37, O-485): format, table size, the stake by label,
 * a depth the drill names (big blinds times CBB_PER_BB) and no ante. It is the one source of the
 * rule: configIdsFor applies it to the rows its query reads, and the shared cases of
 * validation/fixtures/drills/candidate-rule-cases.json hold it here and in the web's reach model
 * (web/src/drills/reach-model.ts), so what sessions run and what the web counts cannot drift apart.
 */
export function configRowMatches(filter: DrillSpotFilter, row: CatalogConfigRow): boolean {
  const { format, table_size: tableSize, depths_bb: depths } = filter.game_config;
  return (
    row.format === format &&
    row.table_size === tableSize &&
    row.stake_label === filter.stake &&
    depths.some((depth) => depth * CBB_PER_BB === row.depth_cbb) &&
    row.ante_cbb === NO_ANTE_CBB
  );
}

/**
 * The configurations a drill reaches, in id order (PR #48 review MEDIUM 8). The query reads the
 * catalog rows of the drill's format and table size with parameterised values and configRowMatches
 * decides the rest, so the drift cases cover what a session start runs. The catalog is small (a
 * few dozen configurations, seeded per format, table size, stake and depth), so filtering the
 * format's rows in process costs nothing a start would notice.
 */
export async function configIdsFor(database: Database, filter: DrillSpotFilter): Promise<string[]> {
  const rows = await database
    .selectFrom("game_config")
    .innerJoin("stake", "stake.id", "game_config.stake_id")
    .select([
      "game_config.id as config_id",
      "game_config.format",
      "game_config.table_size",
      "stake.label as stake_label",
      "game_config.depth_cbb",
      "game_config.ante_cbb",
    ])
    .where("game_config.format", "=", filter.game_config.format)
    .where("game_config.table_size", "=", filter.game_config.table_size)
    .orderBy("game_config.id")
    .execute();
  return rows.filter((row) => configRowMatches(filter, row)).map((row) => row.config_id);
}

/** Every hero and villain seat pairing, out of position first, sorted and without repeats. */
export function pairsFor(filter: DrillSpotFilter): string[] {
  return pairsAt(filter.game_config.table_size, filter.hero_positions, filter.villain_positions);
}

/** pairsFor at a table size: every hero against every villain (every other seat when none), sorted (S41 shares it). */
export function pairsAt(tableSize: number, heroes: readonly Position[], villainSeats: readonly Position[]): string[] {
  const seated = seatedPositions(tableSize);
  const pairs = heroes.flatMap((hero) => {
    const villains = villainSeats.length > 0 ? villainSeats : seated.filter((seat) => seat !== hero);
    return villains.filter((villain) => villain !== hero).map((villain) => canonicalPair(hero, villain).pair);
  });
  return [...new Set(pairs)].sort();
}

export function candidatesFor(configIds: readonly string[], pairs: readonly string[]): PairCandidate[] {
  return configIds.flatMap((config_id) => pairs.map((pair) => ({ config_id, pair })));
}

/**
 * Splits candidates by whether solver-query holds a preflop solution for them (ADR 0018), asking
 * at most MAX_CONCURRENT_SOLVER_CALLS at a time (PR #25 review MEDIUM 3).
 */
export async function splitByCoverage(candidates: readonly PairCandidate[], port: SolverPort): Promise<CandidateSplit> {
  const answers = await mapBounded(candidates, MAX_CONCURRENT_SOLVER_CALLS, async (candidate) => ({
    candidate,
    available: (await port.coverage(candidate.config_id, candidate.pair)).preflop.available,
  }));
  return {
    covered: answers.filter((answer) => answer.available).map((answer) => answer.candidate),
    gaps: answers.filter((answer) => !answer.available).map((answer) => answer.candidate),
  };
}
