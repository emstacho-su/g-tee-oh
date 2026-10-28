/**
 * POST /sessions in drill mode (R3.6, O-249, O-240, ADR 0018), S23's code moved out of
 * sessions/service.ts by the S31 mode split, and the drill-backed prediction and range_paint modes
 * S27 added (O-302): the same spot search, starting with a practice state instead of a hand.
 *
 * The drill must be the user's (404 otherwise). Its trainer settings are merged with the body's
 * partial settings. Its spot filter is expanded into covered (configuration, pair) candidates
 * (candidates.ts); the uncovered rest is recorded as coverage_request rows, once per user and spot
 * (05 section 1, O-240). Each covered pair's tree is searched once for the hero spots: nodes where a
 * hero seat acts in the drill's preflop action families with a hand the hands filter keeps
 * (spot-search.ts). A drill with no hero spot is a 422 no-coverage problem naming why, whose gap
 * rows are still recorded in a transaction. The seed is the body's or 64 random bits (O-249). The
 * session, with its hero spots and its copy of the drill's spot (spot.ts), is written in dealing
 * phase at hand 0 through idempotentWrite; each hand is then dealt straight at a hero spot
 * (deal-hand.ts).
 */
import { findDrill } from "../../drills/repository.js";
import { requireDatabase } from "../../http/database.js";
import { idempotentWrite } from "../../http/idempotent-write.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../../http/problem.js";
import { storedSpotFilterSchema, trainerSettingsSchema, type TrainerSettings } from "../../schemas/drills.js";
import { requireSolverQuery } from "../../solver-query/client.js";
import { candidatesFor, configIdsFor, pairsFor, splitByCoverage } from "../candidates.js";
import { filterUnmetProblem } from "../problems.js";
import { newSessionSeed } from "../randomness.js";
import { insertCoverageRequests, insertSession } from "../repository.js";
import type { SessionCall, SessionCreateBody } from "../session-call.js";
import { toSession, type Session } from "../session-view.js";
import { solverPort } from "../solver-port.js";
import { heroSpotsFor } from "../spot-search.js";
import { spotOf } from "../spot.js";
import { initialState } from "../state.js";

/** The modes a drill backs: drill itself (S23) and S27's practice modes (O-302). */
export type DrillBackedMode = "drill" | "prediction" | "range_paint";

function requireDrillId(body: SessionCreateBody, mode: DrillBackedMode): string {
  if (body.drill_id === undefined) {
    throw new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.badRequest, { detail: `A ${mode} session needs drill_id.` });
  }
  return body.drill_id;
}

function mergedSettings(stored: unknown, overrides: SessionCreateBody["settings"]): TrainerSettings {
  return trainerSettingsSchema.parse({ ...trainerSettingsSchema.parse(stored), ...overrides });
}

export async function createDrillSession(call: SessionCall, body: SessionCreateBody, mode: DrillBackedMode): Promise<Session> {
  const drillId = requireDrillId(body, mode);
  const database = requireDatabase(call.app);
  const drill = await findDrill(database, call.userId, drillId);
  if (drill === undefined) {
    throw new ProblemError(HTTP_STATUS.notFound, PROBLEM_SLUGS.notFound, { detail: "No drill of yours has this id." });
  }
  const settings = mergedSettings(drill.trainer_settings, body.settings);
  const filter = storedSpotFilterSchema.parse(drill.spot_filter);
  const port = solverPort(requireSolverQuery(call.app), call.request);
  const candidates = candidatesFor(await configIdsFor(database, filter), pairsFor(filter));
  const { covered, gaps } = await splitByCoverage(candidates, port);
  const line = filter.line ?? null;
  const spot = spotOf(filter);
  const heroSpots = await heroSpotsFor(covered, { heroPositions: filter.hero_positions, spot, line }, port);
  if (heroSpots.length === 0) {
    // The gap rows are recorded even though the session is refused (05 section 1, O-240).
    await database.transaction().execute((transaction) => insertCoverageRequests(transaction, call.userId, gaps, line));
    const reason = covered.length === 0 ? "noCoverage" : "noHeroNode";
    throw filterUnmetProblem(reason, `${gaps.length} of its ${candidates.length} spots were queued for the builder.`);
  }
  // PR #27 review HIGH 2: a client-supplied seed marks the session seeded (no learning state).
  const state = initialState(body.seed ?? newSessionSeed(), heroSpots, spot, {
    seeded: body.seed !== undefined,
    ...(mode === "drill" ? {} : { practice: mode }),
  });
  return idempotentWrite(call.app, call.request, HTTP_STATUS.created, async (transaction) => {
    await insertCoverageRequests(transaction, call.userId, gaps, line);
    const row = await insertSession(transaction, { userId: call.userId, mode, drillId, settings, state });
    return toSession(row);
  });
}
