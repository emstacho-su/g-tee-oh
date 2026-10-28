/**
 * The frequency view's one read (R4.12, S41, O-353, O-418, ADR 0001): the user's counted preflop
 * decisions per node and hand class, as one parameterised query. The user id is bound as a
 * parameter, never interpolated, and every row is the caller's own (attempt.user_id).
 *
 * Counted: a decision of the user's own session (practice_session.mode not holdout, which measures
 * and never trains, O-274), not client-seeded (NOT_SEEDED_SESSION, PR #27 review HIGH 2), at a
 * preflop spot class (solver-query's key starts "preflop/"; postflop and "unclassified" are out),
 * with hand_class, freq_by_action and action_kinds stored, and no answer-revealing panel on
 * (panels_revealed false, O-274).
 *
 * Mechanism: spots are the MAX_FREQUENCY_SPOTS nodes with the most counted decisions (ties by
 * node_key), each with its newest solution and its most played hand class for the label read. Then
 * every counted decision of those nodes whose action count is the node's is unnested with ordinality
 * over freq_by_action, and grouping sets give, per (node, hand class, action) and per (node, action):
 * the decisions, how many chose that action (action_index is the action's position, O-198), and the
 * mean of the solver's stored frequency. No poker number is computed: counts and means of stored
 * Rust numbers over the user's own decisions (as drift does, O-304; ADR 0004).
 */
import { sql, type RawBuilder } from "kysely";

import type { Database } from "../db.js";
import { NOT_SEEDED_SESSION } from "../learning-state/repository.js";
import { MAX_FREQUENCY_SPOTS } from "../schemas/frequencies.js";

const UNCOUNTED_MODE = "holdout";
const PREFLOP_CLASS_PREFIX = "preflop/%";

export interface FrequencySpotRow {
  nodeKey: string;
  spotClassKey: string;
  solutionId: string;
  sampleHand: string;
  decisions: number;
}

export interface FrequencyCellRow {
  nodeKey: string;
  /** null on the pooled (whole node) rows. */
  handClass: string | null;
  position: number;
  decisions: number;
  chosen: number;
  solverFreq: number;
}

export interface FrequencyRows {
  spots: FrequencySpotRow[];
  cells: FrequencyCellRow[];
}

export interface RawSpot {
  node_key: string;
  spot_class_key: string;
  solution_id: string;
  sample_hand: string;
  decisions: number;
}

export interface RawCell {
  node_key: string;
  hand_class: string | null;
  position: number;
  decisions: number;
  chosen: number;
  solver_freq: number;
}

function countedDecisions(userId: string) {
  return sql`
    select attempt.node_key, attempt.spot_class_key, attempt.solution_id, attempt.hand_class, attempt.action_index,
           attempt.freq_by_action, attempt.created_at
    from attempt
    join practice_session on practice_session.id = attempt.session_id
    where attempt.user_id = ${userId}
      and practice_session.user_id = ${userId}
      and practice_session.mode <> ${UNCOUNTED_MODE}
      and ${NOT_SEEDED_SESSION}
      and attempt.spot_class_key like ${PREFLOP_CLASS_PREFIX}
      and attempt.hand_class is not null
      and attempt.freq_by_action is not null
      and attempt.action_kinds is not null
      and not attempt.panels_revealed`;
}

/** The spots query: the user's most played preflop nodes (exported so a test can EXPLAIN it). */
export function spotsQuery(userId: string): RawBuilder<RawSpot> {
  return sql<RawSpot>`
    with counted as (${countedDecisions(userId)})
    select node_key,
           min(spot_class_key) as spot_class_key,
           (array_agg(solution_id order by created_at desc))[1] as solution_id,
           mode() within group (order by hand_class) as sample_hand,
           count(*)::int as decisions
    from counted
    group by node_key
    order by decisions desc, node_key
    limit ${MAX_FREQUENCY_SPOTS}`;
}

/** The cells query: per (node, hand class, action) and per (node, action) counts and means. */
export function cellsQuery(userId: string, nodeKeys: readonly string[]): RawBuilder<RawCell> {
  return sql<RawCell>`
    with counted as (${countedDecisions(userId)}),
    widths as (
      select node_key, mode() within group (order by cardinality(freq_by_action)) as width
      from counted
      where node_key = any(${[...nodeKeys]}::text[])
      group by node_key
    )
    select counted.node_key, counted.hand_class, (action.position - 1)::int as position,
           count(*)::int as decisions,
           (count(*) filter (where counted.action_index = action.position - 1))::int as chosen,
           avg(action.frequency)::float8 as solver_freq
    from counted
    join widths on widths.node_key = counted.node_key and widths.width = cardinality(counted.freq_by_action)
    cross join lateral unnest(counted.freq_by_action) with ordinality as action(frequency, position)
    group by grouping sets ((counted.node_key, counted.hand_class, action.position), (counted.node_key, action.position))`;
}

/** The user's most played preflop nodes and their per hand class and pooled action counts. */
export async function frequencyRows(database: Database, userId: string): Promise<FrequencyRows> {
  const spots = await spotsQuery(userId).execute(database);
  const nodeKeys = spots.rows.map((row) => row.node_key);
  if (nodeKeys.length === 0) {
    return { spots: [], cells: [] };
  }
  const cells = await cellsQuery(userId, nodeKeys).execute(database);
  return {
    spots: spots.rows.map((row) => ({
      nodeKey: row.node_key,
      spotClassKey: row.spot_class_key,
      solutionId: row.solution_id,
      sampleHand: row.sample_hand,
      decisions: row.decisions,
    })),
    cells: cells.rows.map((row) => ({
      nodeKey: row.node_key,
      handClass: row.hand_class,
      position: row.position,
      decisions: row.decisions,
      chosen: row.chosen,
      solverFreq: row.solver_freq,
    })),
  };
}
