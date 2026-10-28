/**
 * POST /sessions from a catalog spot (R3.16, R3.17, S41, O-350, O-351, O-415, ADR 0018): a prediction
 * (quiz) or range_paint session that names a configuration, hero seats, optional opponents and
 * preflop spot types instead of a drill.
 *
 * Mechanism: the body's shape rules (no repeats, hero and opponent seats disjoint) ran in the schema
 * (schemas/practice-start.ts) and the cross-field rules in practice-rules.ts. Here, before any
 * solver-query call, the configuration must be a catalog game_config row with no ante (the v1 served
 * set, O-33), else 400; and every seat must be seated at its table size (catalog/seats.ts), else
 * 400. The candidates are that one configuration against the pairs of the hero and opponent seats
 * (candidates.ts pairsAt), and the spot is the spot types as preflop action families with every
 * hand and no seat alternation. From there the drill start's machinery runs unchanged
 * (spot-start.ts): coverage split, tree search under the same bounds, gap rows queued, the same
 * 422, and one idempotent write of a session with no drill. Practice modes never read trainer
 * settings, so the session stores the fixed defaults with the body's partial settings merged.
 */
import { AUTOMATED_TRAINER_DEFAULTS } from "../../automated/settings.js";
import { seatedPositions } from "../../catalog/seats.js";
import type { Database } from "../../db.js";
import { requireDatabase } from "../../http/database.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../../http/problem.js";
import { trainerSettingsSchema } from "../../schemas/drills.js";
import type { CatalogSpot } from "../../schemas/practice-start.js";
import { candidatesFor, NO_ANTE_CBB, pairsAt } from "../candidates.js";
import { newSessionSeed } from "../randomness.js";
import type { SessionCall, SessionCreateBody } from "../session-call.js";
import type { Session } from "../session-view.js";
import { sessionSpotSchema } from "../spot.js";
import { initialState } from "../state.js";
import { quizSpotFilter, quizStateOf } from "./practice-rules.js";
import { findHeroSpots, writeSpotSession } from "./spot-start.js";

/** The modes a catalog spot starts (O-415). */
export type CatalogSpotMode = "prediction" | "range_paint";

/** A catalog spot's search starts at each pair's root. */
const ROOT_LINE = null;

function badRequest(detail: string): ProblemError {
  return new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.badRequest, { detail });
}

/** The served configuration's table size; a 400 when the catalog has no such served configuration. */
async function servedTableSize(database: Database, configId: string): Promise<number> {
  const row = await database
    .selectFrom("game_config")
    .select(["table_size", "ante_cbb"])
    .where("id", "=", configId)
    .executeTakeFirst();
  if (row === undefined || row.ante_cbb !== NO_ANTE_CBB) {
    throw badRequest("No catalog configuration has this id.");
  }
  return row.table_size;
}

function requireSeated(spot: CatalogSpot, tableSize: number): void {
  const seated: readonly string[] = seatedPositions(tableSize);
  for (const seat of [...spot.hero_positions, ...(spot.villain_positions ?? [])]) {
    if (!seated.includes(seat)) {
      throw badRequest(`${seat} is not seated at a ${tableSize}-handed table.`);
    }
  }
}

export async function createCatalogSpotSession(
  call: SessionCall,
  body: SessionCreateBody & { catalog_spot: CatalogSpot },
  mode: CatalogSpotMode,
): Promise<Session> {
  const catalogSpot = body.catalog_spot;
  const tableSize = await servedTableSize(requireDatabase(call.app), catalogSpot.config_id);
  requireSeated(catalogSpot, tableSize);
  const pairs = pairsAt(tableSize, catalogSpot.hero_positions, catalogSpot.villain_positions ?? []);
  const candidates = candidatesFor([catalogSpot.config_id], pairs);
  const spot = sessionSpotSchema.parse({ preflop_action: catalogSpot.spot_types, hands: { mode: "all" }, alternate_seats: false });
  const quiz = quizStateOf(body.quiz);
  const quizFilter = quizSpotFilter(quiz);
  const search = { candidates, heroPositions: catalogSpot.hero_positions, spot, line: ROOT_LINE };
  const found = await findHeroSpots(call, quizFilter === undefined ? search : { ...search, filter: quizFilter });
  // PR #27 review HIGH 2: a client-supplied seed marks the session seeded (no learning state).
  const state = initialState(body.seed ?? newSessionSeed(), found.heroSpots, spot, {
    seeded: body.seed !== undefined,
    practice: mode,
    ...(quiz === undefined ? {} : { quiz }),
  });
  const settings = trainerSettingsSchema.parse({ ...AUTOMATED_TRAINER_DEFAULTS, ...body.settings });
  return writeSpotSession(call, { mode, drillId: null, settings, state, found, line: ROOT_LINE });
}
