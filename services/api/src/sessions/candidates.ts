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
import { canonicalPair, seatedPositions } from "../catalog/seats.js";
import type { Database } from "../db.js";
import type { SpotFilter } from "../schemas/drills.js";
import type { SolverPort } from "./solver-port.js";
import { mapBounded, MAX_CONCURRENT_SOLVER_CALLS } from "./concurrency.js";

/** Centi-big-blinds per big blind: the catalog stores depths in cbb (A4 section 1). */
export const CBB_PER_BB = 100;
const NO_ANTE_CBB = 0;

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

export async function configIdsFor(database: Database, filter: DrillSpotFilter): Promise<string[]> {
  const depths = filter.game_config.depths_bb.map((depth) => depth * CBB_PER_BB);
  const rows = await database
    .selectFrom("game_config")
    .innerJoin("stake", "stake.id", "game_config.stake_id")
    .select("game_config.id")
    .where("game_config.format", "=", filter.game_config.format)
    .where("game_config.table_size", "=", filter.game_config.table_size)
    .where("stake.label", "=", filter.stake)
    .where("game_config.depth_cbb", "in", depths)
    .where("game_config.ante_cbb", "=", NO_ANTE_CBB)
    .orderBy("game_config.id")
    .execute();
  return rows.map((row) => row.id);
}

/** Every hero and villain seat pairing, out of position first, sorted and without repeats. */
export function pairsFor(filter: DrillSpotFilter): string[] {
  const seated = seatedPositions(filter.game_config.table_size);
  const pairs = filter.hero_positions.flatMap((hero) => {
    const villains = filter.villain_positions.length > 0 ? filter.villain_positions : seated.filter((seat) => seat !== hero);
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
