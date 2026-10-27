/**
 * Catalog reads (R3.2, A4 section 2, ADR 0014, O-234). Stakes and game configurations come back
 * as stored: cents, basis points and centi-big-blinds, with no rake arithmetic in TypeScript
 * (ADR 0004). A configuration is keyed by its game_config id, which names its stake, so a 1/3 and
 * a 2/5 configuration at the same table size and depth are two rows (criterion 11).
 *
 * Mechanism: list queries are keyset pages ordered by id; the caller passes the last id it served
 * (from the cursor) and limit + 1, and the extra row only tells it another page exists
 * (http/cursor.ts). Filters are typed Kysely parameters, never interpolated SQL; an absent filter
 * adds no condition (an empty and() is true).
 */
import type { Database } from "../db.js";
import type { GameConfig, Stake } from "../schemas/catalog.js";

type GameFormat = Stake["format"];

const PREFLOP_KIND = "preflop";
const PUBLISHED_STATUS = "published";

export interface StakeListQuery {
  format?: GameFormat | undefined;
  afterId?: string | undefined;
  fetch: number;
}

export interface ConfigListQuery {
  format?: GameFormat | undefined;
  stakeId?: string | undefined;
  tableSize?: number | undefined;
  afterId?: string | undefined;
  fetch: number;
}

export interface ConfigSeating {
  id: string;
  tableSize: number;
}

export async function listStakes(database: Database, query: StakeListQuery): Promise<Stake[]> {
  const { format, afterId } = query;
  return database
    .selectFrom("stake")
    .select(["id", "format", "label", "bb_cents", "rake_percent_bp", "rake_cap_cents", "no_flop_no_drop", "note"])
    .where((eb) =>
      eb.and([
        ...(format === undefined ? [] : [eb("format", "=", format)]),
        ...(afterId === undefined ? [] : [eb("id", ">", afterId)]),
      ]),
    )
    .orderBy("id")
    .limit(query.fetch)
    .execute();
}

export async function listConfigs(database: Database, query: ConfigListQuery): Promise<GameConfig[]> {
  const { format, stakeId, tableSize, afterId } = query;
  return database
    .selectFrom("game_config")
    .innerJoin("stake", "stake.id", "game_config.stake_id")
    .select([
      "game_config.id as config_id",
      "game_config.format",
      "game_config.table_size",
      "game_config.stake_id",
      "stake.label as stake_label",
      "game_config.depth_cbb",
      "game_config.straddle",
      "game_config.ante_cbb",
    ])
    .where((eb) =>
      eb.and([
        ...(format === undefined ? [] : [eb("game_config.format", "=", format)]),
        ...(stakeId === undefined ? [] : [eb("game_config.stake_id", "=", stakeId)]),
        ...(tableSize === undefined ? [] : [eb("game_config.table_size", "=", tableSize)]),
        ...(afterId === undefined ? [] : [eb("game_config.id", ">", afterId)]),
      ]),
    )
    .orderBy("game_config.id")
    .limit(query.fetch)
    .execute();
}

/** The configuration's table size, or undefined when no configuration has this id. */
export async function findConfigSeating(database: Database, configId: string): Promise<ConfigSeating | undefined> {
  const row = await database
    .selectFrom("game_config")
    .select(["id", "table_size"])
    .where("id", "=", configId)
    .executeTakeFirst();
  return row === undefined ? undefined : { id: row.id, tableSize: row.table_size };
}

/** The position pairs of a configuration that have a published preflop solution. */
export async function publishedPreflopPairs(database: Database, configId: string): Promise<ReadonlySet<string>> {
  const rows = await database
    .selectFrom("solution")
    .select("position_pair")
    .distinct()
    .where("game_config_id", "=", configId)
    .where("kind", "=", PREFLOP_KIND)
    .where("status", "=", PUBLISHED_STATUS)
    .where("position_pair", "is not", null)
    .execute();
  return new Set(rows.flatMap((row) => (row.position_pair === null ? [] : [row.position_pair])));
}
