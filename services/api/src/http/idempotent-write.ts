/**
 * Writes that are safe to retry under an Idempotency-Key (R3.1, A5 section 3, O-232; the PR #20
 * review HIGH 1). Every handler whose write has a side effect runs it through idempotentWrite.
 *
 * Mechanism: the work runs in one database transaction. When the request owns an Idempotency-Key
 * claim (request.idempotencyClaim, set by plugins/idempotency.ts), the response the handler will
 * send is stored in that same transaction (completeKey), so the side effect and its stored
 * response commit together or not at all. After the commit nothing can free the key: a reply that
 * fails to send, or an error handler that turns the response into a 500, finds the claim already
 * completed and its release matches nothing, so the retry replays the stored response instead of
 * writing again. If the claim was taken over while the work ran (its lease ran out,
 * idempotency-store.ts), completeKey stores nothing and the transaction is rolled back with a 409,
 * so a request that lost its claim never commits. Work that throws a problem (a 404 or 409) rolls
 * back too, and the plugin stores that problem response outside the transaction, which is safe
 * because nothing was written.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { Database } from "../db.js";
import { completeKey } from "../plugins/idempotency-store.js";
import { requireDatabase } from "./database.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "./problem.js";

/**
 * Runs work in a transaction and, under an Idempotency-Key, stores `statusCode` and the work's
 * result (null for no body) as the key's response in the same transaction.
 */
export async function idempotentWrite<Result>(
  app: FastifyInstance,
  request: FastifyRequest,
  statusCode: number,
  work: (transaction: Database) => Promise<Result>,
): Promise<Result> {
  const claim = request.idempotencyClaim;
  return requireDatabase(app)
    .transaction()
    .execute(async (transaction) => {
      const result = await work(transaction);
      if (claim !== null) {
        const bodyJson = result === null || result === undefined ? null : JSON.stringify(result);
        const stored = await completeKey(transaction, claim, statusCode, bodyJson);
        if (!stored) {
          throw new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.idempotencyInFlight, {
            detail: "This request's Idempotency-Key claim was taken over by a retry; nothing was written.",
          });
        }
      }
      return result;
    });
}
