/**
 * The frequency view's one read (R4.12, S41, O-353, O-418, ADR 0001): the user's counted preflop
 * decisions per spot and hand class, as one parameterised query. The user id is bound as a
 * parameter, never interpolated, and every row is the caller's own (attempt.user_id and the session's
 * user_id both).
 *
 * Counted: a decision of the user's own session (practice_session.mode not holdout, which measures
 * and never trains, O-274), not client-seeded (NOT_SEEDED_SESSION, PR #27 review HIGH 2), at a
 * preflop spot class (solver-query's key starts "preflop/"; postflop and "unclassified" are out),
 * with hand_class, freq_by_action and action_kinds stored, and no answer-revealing panel on
 * (panels_revealed false, O-274).
 *
 * Mechanism, one statement (PR #39 review finding 7): a spot is a node of one solution, the exact
 * solution each decision was graded on (attempt.solution_id), so a rebuilt node is its own spot and
 * never pooled with the old build's actions (finding 6). The spots are the MAX_FREQUENCY_SPOTS with
 * the most counted decisions (ties by node_key, then solution), each with its most played hand class
 * for the label read. Their decisions are unnested with ordinality over freq_by_action, and grouping
 * sets give, per (spot, hand class, action) and per (spot, action): the decisions, how many chose
 * that action (action_index is the action's position, O-198), and the mean of the solver's stored
 * frequency. No poker number is computed: counts and means of stored Rust numbers over the user's own
 * decisions (as drift does, O-304; ADR 0004).
 */
import { sql, type RawBuilder } from "kysely";

import type { Database } from "../db.js";
import { NOT_SEEDED_SESSION } from "../learning-state/repository.js";
import { MAX_FREQUENCY_SPOTS } from "../schemas/frequencies.js";

const UNCOUNTED_MODE = "holdout";
const PREFLOP_CLASS_PREFIX = "preflop/%";

export interface FrequencySpotRow {
  solutionId: string;
  nodeKey: string;
  spotClassKey: string;
  sampleHand: string;
}

export interface FrequencyCellRow {
  solutionId: string;
  nodeKey: string;
  /** null on the pooled (whole spot) rows. */
  handClass: string | null;
  position: number;
  decisions: number;
  chosen: number;
  solverFreq: number;
}

export interface FrequencyRows {
  /** In listing order: the most counted decisions first. */
  spots: FrequencySpotRow[];
  cells: FrequencyCellRow[];
}

export interface RawFrequencyRow {
  solution_id: string;
  node_key: string;
  spot_class_key: string;
  sample_hand: string;
  spot_decisions: number;
  hand_class: string | null;
  position: number;
  decisions: number;
  chosen: number;
  solver_freq: number;
}

/** The one statement (exported so a test can EXPLAIN it). */
export function frequencyQuery(userId: string): RawBuilder<RawFrequencyRow> {
  return sql<RawFrequencyRow>`
    with counted as (
      select attempt.solution_id, attempt.node_key, attempt.spot_class_key, attempt.hand_class, attempt.action_index,
             attempt.freq_by_action
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
        and not attempt.panels_revealed
    ),
    spots as (
      select solution_id, node_key,
             min(spot_class_key) as spot_class_key,
             mode() within group (order by hand_class) as sample_hand,
             count(*)::int as spot_decisions
      from counted
      group by solution_id, node_key
      order by spot_decisions desc, node_key, solution_id
      limit ${MAX_FREQUENCY_SPOTS}
    )
    select spots.solution_id, spots.node_key, spots.spot_class_key, spots.sample_hand, spots.spot_decisions,
           counted.hand_class, (action.position - 1)::int as position,
           count(*)::int as decisions,
           (count(*) filter (where counted.action_index = action.position - 1))::int as chosen,
           avg(action.frequency)::float8 as solver_freq
    from counted
    join spots on spots.solution_id = counted.solution_id and spots.node_key = counted.node_key
    cross join lateral unnest(counted.freq_by_action) with ordinality as action(frequency, position)
    group by grouping sets (
      (spots.solution_id, spots.node_key, spots.spot_class_key, spots.sample_hand, spots.spot_decisions, counted.hand_class, action.position),
      (spots.solution_id, spots.node_key, spots.spot_class_key, spots.sample_hand, spots.spot_decisions, action.position)
    )
    order by spots.spot_decisions desc, spots.node_key, spots.solution_id`;
}

/** The user's most played preflop spots and their per hand class and pooled action counts. */
export async function frequencyRows(database: Database, userId: string): Promise<FrequencyRows> {
  const rows = (await frequencyQuery(userId).execute(database)).rows;
  const spots = new Map<string, FrequencySpotRow>();
  for (const row of rows) {
    const key = `${row.solution_id}/${row.node_key}`;
    if (!spots.has(key)) {
      spots.set(key, { solutionId: row.solution_id, nodeKey: row.node_key, spotClassKey: row.spot_class_key, sampleHand: row.sample_hand });
    }
  }
  return {
    spots: [...spots.values()],
    cells: rows.map((row) => ({
      solutionId: row.solution_id,
      nodeKey: row.node_key,
      handClass: row.hand_class,
      position: row.position,
      decisions: row.decisions,
      chosen: row.chosen,
      solverFreq: row.solver_freq,
    })),
  };
}
