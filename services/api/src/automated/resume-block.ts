/**
 * Resuming an automated session whose closed block waits for its next pick (R4.10, O-270, O-272,
 * PR #27 review HIGH 3).
 *
 * A decision that closes a block when the class catalog cannot load (or covers no class of the
 * scope) still commits: the block is closed and stays in the state with served equal to its size
 * (block.ts isPickPending). GET /next calls resumePendingBlock before it derives: it loads the
 * catalog outside any transaction (a failure answers the catalog's problem, 502 or 503, and writes
 * nothing, so the next GET /next retries), then picks the block in one transaction (lock, version
 * check, chooseNextBlock, coverage requests, state write with state_version + 1) exactly as the
 * decision would have. This is the one write GET /next makes, once per pending pick: a second GET
 * finds the block picked and answers the same prompt. A concurrent GET that lost the race reads the
 * winner's row. A scope with no covered class records its gaps (O-240) and answers 422 no-coverage.
 */
import type { Database } from "../db.js";
import { requireDatabase } from "../http/database.js";
import { insertCoverageRequests, lockSession, writeState, type SessionRow } from "../sessions/repository.js";
import type { SessionCall } from "../sessions/session-call.js";
import { requireSolverQuery } from "../solver-query/client.js";
import { staleStateProblem } from "../grading/attempts.js";
import { pendingPickOf, withBlock } from "./block.js";
import { loadClassCatalog, type ClassCatalog } from "./class-catalog.js";
import { chooseNextBlock, nextBlockRequest, noClassProblem } from "./next-block.js";

/** Coverage requests for whole pairs name no line. */
const NO_LINE = null;

type Resumed = { row: SessionRow; gaps: number | null };

async function pickInTransaction(transaction: Database, catalog: ClassCatalog, call: SessionCall, session: SessionRow, now: Date): Promise<Resumed> {
  const locked = await lockSession(transaction, call.userId, session.id);
  if (locked === undefined) {
    throw staleStateProblem();
  }
  const learning = pendingPickOf(locked);
  if (locked.stateVersion !== session.stateVersion || learning === null) {
    return { row: locked, gaps: null };
  }
  const next = await chooseNextBlock(transaction, catalog, nextBlockRequest({ userId: call.userId, now, session: locked }, learning));
  await insertCoverageRequests(transaction, call.userId, next.gaps, NO_LINE);
  if (next.pick === null) {
    return { row: locked, gaps: next.gaps.length };
  }
  const written = await writeState(transaction, {
    userId: call.userId,
    sessionId: locked.id,
    expectedVersion: locked.stateVersion,
    state: { ...locked.state, learning: withBlock(learning, next.pick), spots: next.pick.spots },
  });
  if (written === undefined) {
    throw staleStateProblem();
  }
  return { row: written, gaps: null };
}

/** The session with its pending pick made (see the module doc); any other session as given. */
export async function resumePendingBlock(call: SessionCall, session: SessionRow, now: Date): Promise<SessionRow> {
  if (pendingPickOf(session) === null) {
    return session;
  }
  const database = requireDatabase(call.app);
  const catalog = await loadClassCatalog(requireSolverQuery(call.app), database);
  const resumed = await database.transaction().execute((transaction) => pickInTransaction(transaction, catalog, call, session, now));
  if (resumed.gaps !== null) {
    throw noClassProblem(resumed.gaps);
  }
  return resumed.row;
}
