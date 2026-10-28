/**
 * The search-and-write half of a session start that names spots (R3.6, R3.16, R3.17, O-240, O-312,
 * ADR 0018): shared by the drill start (modes/drill.ts, S23 and S27) and S41's catalog-spot start
 * (modes/catalog-spot.ts, O-415), so both keep the same bounds, coverage queueing, 422 and
 * idempotency.
 *
 * Mechanism: the (configuration, pair) candidates are split by solver-query's coverage
 * (candidates.ts), each covered pair's tree is searched once for hero spots (spot-search.ts, with its
 * MAX_SPOT_SEARCH_NODES, MAX_SPOTS_PER_PAIR and MAX_HERO_SPOTS bounds), and no hero spot is the 422
 * no-coverage problem with its counts, after the gap rows are recorded in their own transaction
 * (05 section 1). A found set is written with idempotentWrite: the gap rows and the session in one
 * transaction under the request's optional Idempotency-Key, so a replay answers the stored session.
 */
import { requireDatabase } from "../../http/database.js";
import { idempotentWrite } from "../../http/idempotent-write.js";
import { HTTP_STATUS, type ProblemError } from "../../http/problem.js";
import type { TrainerSettings } from "../../schemas/drills.js";
import { requireSolverQuery, type SqNode } from "../../solver-query/client.js";
import { splitByCoverage, type PairCandidate } from "../candidates.js";
import { filterUnmetProblem } from "../problems.js";
import { insertCoverageRequests, insertSession } from "../repository.js";
import type { SessionCall } from "../session-call.js";
import { toSession, type Session } from "../session-view.js";
import { solverPort } from "../solver-port.js";
import { heroSpotsFor } from "../spot-search.js";
import type { SessionSpot } from "../spot.js";
import type { HeroSpot, PersistedState } from "../state.js";

export interface SpotSearchInput {
  candidates: readonly PairCandidate[];
  heroPositions: readonly string[];
  spot: SessionSpot;
  /** The line to start every search at, or null for each pair's root. */
  line: string | null;
  /** S41 (O-411 amended): keeps only the hero nodes `accept` takes; `refused` is the 422 when it took none. */
  filter?: SpotFilter;
}

export interface SpotFilter {
  accept: (node: SqNode) => boolean;
  refused: () => ProblemError;
}

export interface FoundSpots {
  heroSpots: HeroSpot[];
  gaps: PairCandidate[];
  coverage: { pairs_total: number; pairs_covered: number; pairs_queued: number };
}

/** The hero spots of the covered candidates; a 422 (gaps recorded) when there is none. */
export async function findHeroSpots(call: SessionCall, input: SpotSearchInput): Promise<FoundSpots> {
  const database = requireDatabase(call.app);
  const port = solverPort(requireSolverQuery(call.app), call.request);
  const { covered, gaps } = await splitByCoverage(input.candidates, port);
  // Whether the filter turned away a hero node, so an empty result names the filter, not the library.
  let refusedAny = false;
  const filter = input.filter;
  const accept =
    filter === undefined
      ? undefined
      : (node: SqNode): boolean => {
          const taken = filter.accept(node);
          refusedAny = refusedAny || !taken;
          return taken;
        };
  const search = { heroPositions: input.heroPositions, spot: input.spot, line: input.line, ...(accept === undefined ? {} : { accept }) };
  const heroSpots = await heroSpotsFor(covered, search, port);
  const total = input.candidates.length;
  if (heroSpots.length === 0) {
    // The gap rows are recorded even though the session is refused (05 section 1, O-240).
    await database.transaction().execute((transaction) => insertCoverageRequests(transaction, call.userId, gaps, input.line));
    if (refusedAny && filter !== undefined) {
      throw filter.refused();
    }
    const reason = covered.length === 0 ? "noCoverage" : "noHeroNode";
    throw filterUnmetProblem(reason, `${gaps.length} of its ${total} spots were queued for the builder.`, {
      pairsTotal: total,
      pairsQueued: gaps.length,
    });
  }
  return { heroSpots, gaps, coverage: { pairs_total: total, pairs_covered: covered.length, pairs_queued: gaps.length } };
}

export interface SpotSessionWrite {
  mode: "drill" | "prediction" | "range_paint";
  drillId: string | null;
  settings: TrainerSettings;
  state: PersistedState;
  found: FoundSpots;
  line: string | null;
}

/** Writes the gap rows and the session in one idempotent transaction (O-232); the session carries its coverage (O-312). */
export async function writeSpotSession(call: SessionCall, write: SpotSessionWrite): Promise<Session> {
  return idempotentWrite(call.app, call.request, HTTP_STATUS.created, async (transaction) => {
    await insertCoverageRequests(transaction, call.userId, write.found.gaps, write.line);
    const row = await insertSession(transaction, {
      userId: call.userId,
      mode: write.mode,
      drillId: write.drillId,
      settings: write.settings,
      state: write.state,
    });
    return { ...toSession(row), coverage: write.found.coverage };
  });
}
