/**
 * POST /explain/{attempt_id}/ask (R3.20, O-305 to O-308, A6 section 5, ADR 0016, PM1, PM3).
 *
 * Order (authentication, CSRF and the global per-address limit run first in the plugins, then the
 * route's per-user Ask limit, rate-limit.ts):
 * 1. the question, cleaned of control characters; nothing left is a 400;
 * 2. the attempt, owned by the session user, else 404;
 * 3. the flag: off (or no model client) is 503 ask-disabled, with no model call and no spend;
 * 4. the grounding (attempt row, node row, insights) and the cache key (PM1): a hit answers
 *    cached true with cost 0 and spends nothing, so it is served even above the cap;
 * 5. single flight (single-flight.ts, PR #29 review L10): while an identical ask is generating,
 *    this one waits for it and is then served from the cache;
 * 6. the reservation: the worst case of every call (reservation.ts), under a row lock (spend.ts);
 *    spent plus the reservation above the cap is 429 ask-cap-reached with no model call. The cache
 *    is read once more after reserving, and a hit then refunds the reservation;
 * 7. the model: one call, validated (validator.ts); on failure one regeneration that names the
 *    unsupported values in a second user turn, validated again. The Idempotency-Key claim is
 *    renewed before each call and on a timer while it runs (claim-hold.ts, PR #29 review HIGH 2);
 *    a claim found lost stops the Ask with a 409 before another call;
 * 8. the spend settles to what the calls may have cost (PR #29 review HIGH 1): a call that
 *    answered costs its usage; a failed call costs the usage its reply reported, nothing for a
 *    non-2xx status, or its full reservation when the request was sent and no usage came back
 *    (model.ts ModelCharge). A failed first call answers 502 with a fixed message; a failed
 *    regeneration keeps the first answer, unvalidated, and its cost is counted too;
 * 9. one idempotent write (idempotentWrite): the spend settled and the answer stored (on conflict
 *    do nothing), committed with the Idempotency-Key's response.
 *
 * The log line carries the attempt id, cached, validated, cost and token counts; never the key, the
 * prompt, the question or the answer (PM3).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";

import type { AppConfig } from "../config.js";
import type { Database } from "../db.js";
import { requireDatabase } from "../http/database.js";
import { idempotentWrite } from "../http/idempotent-write.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { requireSession } from "../plugins/authenticate.js";
import type { askResultSchema } from "../schemas/explain.js";
import { requireSolverQuery } from "../solver-query/client.js";
import { findCached, questionHash, storeAnswer, type CachedAnswer, type CacheKey } from "./cache.js";
import { holdClaim, type ClaimHold } from "./claim-hold.js";
import { findOwnedAttempt, loadGrounding, type GroundingBundle } from "./grounding.js";
import { ModelCallError, type ModelClient, type ModelResponse } from "./model.js";
import { costCents } from "./pricing.js";
import { ASK_MAX_TOKENS, MAX_MODEL_CALLS, regenerationTurn, systemPrompt, userTurn } from "./prompt.js";
import { cleanQuestion } from "./question.js";
import { askPromptChars, callReservationCents } from "./reservation.js";
import { runAlone, runningFor } from "./single-flight.js";
import { monthOf, reserveSpend, settleSpend } from "./spend.js";
import { askEnabled } from "./status.js";
import { validateAnswer } from "./validator.js";

export type AskResult = z.infer<typeof askResultSchema>;

export const UNVALIDATED_WARNING = "Some numbers in this answer could not be checked against the solver data.";

const NOTHING = 0;
const HEX = "hex";

interface Generated {
  text: string;
  validated: boolean;
  model: string;
  calls: readonly ModelResponse[];
  /** What every call made may have cost, settled against the reservation. */
  cents: number;
}

type CallOutcome =
  | { kind: "answered"; response: ModelResponse; cents: number }
  | { kind: "failed"; cents: number; errorName: string }
  | { kind: "claim-lost" };

/** The Ask stopped before an answer; `cents` is what its calls may have cost. */
class AskStopped extends Error {
  constructor(
    readonly reason: "model" | "claim-lost",
    readonly cents: number,
    readonly errorName: string,
  ) {
    super(`the Ask stopped: ${reason}`);
    this.name = "AskStopped";
  }
}

export interface AskContext {
  app: FastifyInstance;
  config: AppConfig;
  request: FastifyRequest;
  now: Date;
}

interface Pricing {
  config: AppConfig;
  perCallCents: number;
}

function disabledProblem(): ProblemError {
  return new ProblemError(HTTP_STATUS.unavailable, PROBLEM_SLUGS.askDisabled, {
    detail: "Ask is off until a model key is configured.",
  });
}

function capProblem(): ProblemError {
  return new ProblemError(HTTP_STATUS.tooManyRequests, PROBLEM_SLUGS.askCapReached, {
    detail: "This month's Ask budget is used.",
  });
}

function modelProblem(): ProblemError {
  return new ProblemError(HTTP_STATUS.badGateway, PROBLEM_SLUGS.upstream, {
    detail: "The explanation model could not answer. A call the model may have billed counts toward this month's budget.",
  });
}

function claimLostProblem(): ProblemError {
  return new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.idempotencyInFlight, {
    detail: "This request's Idempotency-Key claim was taken over by a retry; the Ask stopped.",
  });
}

function resultOf(attemptId: string, answer: CachedAnswer, cached: boolean, cost: number): AskResult {
  return {
    attempt_id: attemptId,
    text: answer.text,
    validated: answer.validated,
    warning: answer.validated ? null : UNVALIDATED_WARNING,
    cached,
    cost_cents: cost,
  };
}

/** What a failed call may have cost (model.ts ModelCharge; PR #29 review HIGH 1). */
function failedCallCents(pricing: Pricing, error: unknown): number {
  if (!(error instanceof ModelCallError)) {
    // Not the adapter's error: nothing says the call was not billed, so it keeps its reservation.
    return pricing.perCallCents;
  }
  switch (error.charge.kind) {
    case "none":
      return NOTHING;
    case "usage":
      return costCents(pricing.config.askModel, error.charge.usage);
    case "unknown":
      return pricing.perCallCents;
  }
}

/** One model call, after renewing the claim; never throws. */
async function callModel(model: ModelClient, hold: ClaimHold, pricing: Pricing, system: string, user: string): Promise<CallOutcome> {
  if (!(await hold.renew())) {
    return { kind: "claim-lost" };
  }
  try {
    const response = await model.complete({ system, user, maxTokens: ASK_MAX_TOKENS });
    return { kind: "answered", response, cents: costCents(pricing.config.askModel, response) };
  } catch (error: unknown) {
    return { kind: "failed", cents: failedCallCents(pricing, error), errorName: error instanceof Error ? error.name : typeof error };
  }
}

/** The first answer and, when it fails the validator, one regeneration (O-308). */
async function generate(model: ModelClient, hold: ClaimHold, pricing: Pricing, bundle: GroundingBundle, question: string): Promise<Generated> {
  const system = systemPrompt(bundle.canonical);
  const first = await callModel(model, hold, pricing, system, userTurn(question));
  if (first.kind === "claim-lost") {
    throw new AskStopped("claim-lost", NOTHING, "claim-lost");
  }
  if (first.kind === "failed") {
    throw new AskStopped("model", first.cents, first.errorName);
  }
  const firstCheck = validateAnswer(first.response.text, bundle);
  const kept = { text: first.response.text, validated: false, model: first.response.model, calls: [first.response] };
  if (firstCheck.ok) {
    return { ...kept, validated: true, cents: first.cents };
  }
  const second = await callModel(model, hold, pricing, system, regenerationTurn(question, firstCheck));
  if (second.kind === "claim-lost") {
    throw new AskStopped("claim-lost", first.cents, "claim-lost");
  }
  if (second.kind === "failed") {
    // The regeneration failed after a first answer that was paid for: keep it, unvalidated, and
    // count what the failed call may have cost too.
    return { ...kept, cents: first.cents + second.cents };
  }
  const secondCheck = validateAnswer(second.response.text, bundle);
  return {
    text: second.response.text,
    validated: secondCheck.ok,
    model: second.response.model,
    calls: [first.response, second.response],
    cents: first.cents + second.cents,
  };
}

function logAnswer(context: AskContext, attemptId: string, result: AskResult, calls: readonly ModelResponse[]): void {
  const inputTokens = calls.reduce((sum, call) => sum + call.inputTokens, 0);
  const outputTokens = calls.reduce((sum, call) => sum + call.outputTokens, 0);
  context.request.log.info(
    {
      attempt_id: attemptId,
      cached: result.cached,
      validated: result.validated,
      cost_cents: result.cost_cents,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
    "ask answered",
  );
}

function serveHit(context: AskContext, attemptId: string, cached: CachedAnswer): Promise<AskResult> {
  const hit = resultOf(attemptId, cached, true, NOTHING);
  logAnswer(context, attemptId, hit, []);
  return idempotentWrite(context.app, context.request, HTTP_STATUS.ok, () => Promise.resolve(hit));
}

async function storeGenerated(context: AskContext, key: CacheKey, attemptId: string, month: string, reserved: number, generated: Generated) {
  const result = resultOf(attemptId, generated, false, generated.cents);
  try {
    return await idempotentWrite(context.app, context.request, HTTP_STATUS.ok, async (transaction) => {
      await settleSpend(transaction, month, reserved, generated.cents);
      await storeAnswer(transaction, key, { text: generated.text, validated: generated.validated, model: generated.model, costCents: generated.cents });
      return result;
    });
  } catch (error: unknown) {
    // The calls were made and may have been billed: record that even though the write failed.
    await settleSpend(requireDatabase(context.app), month, reserved, generated.cents);
    throw error;
  }
}

/** Reserves, calls the model under the held claim, settles and stores (steps 6 to 9). */
async function generateAndStore(context: AskContext, model: ModelClient, bundle: GroundingBundle, key: CacheKey, attemptId: string, question: string) {
  const database: Database = requireDatabase(context.app);
  const month = monthOf(context.now);
  const pricing: Pricing = { config: context.config, perCallCents: callReservationCents(context.config.askModel, askPromptChars(bundle.canonical, question)) };
  const reserved = MAX_MODEL_CALLS * pricing.perCallCents;
  if (!(await reserveSpend(database, month, reserved, context.config.askMonthlyCapCents))) {
    throw capProblem();
  }
  const cachedMeanwhile = await findCached(database, key);
  if (cachedMeanwhile !== undefined) {
    await settleSpend(database, month, reserved, NOTHING);
    return serveHit(context, attemptId, cachedMeanwhile);
  }
  const hold = holdClaim(database, context.request.idempotencyClaim, context.request.log);
  try {
    const generated = await generate(model, hold, pricing, bundle, question);
    const result = await storeGenerated(context, key, attemptId, month, reserved, generated);
    logAnswer(context, attemptId, result, generated.calls);
    return result;
  } catch (error: unknown) {
    if (!(error instanceof AskStopped)) {
      throw error;
    }
    await settleSpend(database, month, reserved, error.cents);
    if (error.reason === "claim-lost") {
      throw claimLostProblem();
    }
    context.request.log.warn({ error_name: error.errorName, cost_cents: error.cents }, "ask model call failed");
    throw modelProblem();
  } finally {
    hold.stop();
  }
}

/** Answers one Ask request (see the order above). */
export async function answerAsk(context: AskContext, attemptId: string, rawQuestion: string): Promise<AskResult> {
  const question = cleanQuestion(rawQuestion);
  if (question === "") {
    throw new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.badRequest, { detail: "The question is empty." });
  }
  const database = requireDatabase(context.app);
  const attempt = await findOwnedAttempt(database, requireSession(context.request).userId, attemptId);
  const model = context.app.modelClient;
  if (!askEnabled(context.app, context.config) || model === null) {
    throw disabledProblem();
  }
  const bundle = await loadGrounding(requireSolverQuery(context.app), context.request, attempt);
  const key: CacheKey = { solutionId: attempt.solution_id, nodeKey: attempt.node_key, hand: attempt.hand, questionHash: questionHash(bundle.canonical, question) };
  const flightKey = [key.solutionId, key.nodeKey, key.hand, key.questionHash.toString(HEX)].join("|");
  const cached = await findCached(database, key);
  if (cached !== undefined) {
    return serveHit(context, attemptId, cached);
  }
  // No await between this check and runAlone, so two misses cannot both start generating.
  const running = runningFor(flightKey);
  if (running !== undefined) {
    // An identical ask is generating; its outcome (answer or failure) is its own request's.
    await running.catch(() => undefined);
    const generatedMeanwhile = await findCached(database, key);
    if (generatedMeanwhile !== undefined) {
      return serveHit(context, attemptId, generatedMeanwhile);
    }
  }
  return runAlone(flightKey, () => generateAndStore(context, model, bundle, key, attemptId, question));
}
