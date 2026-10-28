/**
 * POST /explain/{attempt_id}/ask (R3.20, O-305 to O-308, A6 section 5, ADR 0016, PM1, PM3).
 *
 * Order (authentication, CSRF and the per-user rate limit run first, in the plugins):
 * 1. the question, cleaned of control characters; nothing left is a 400;
 * 2. the attempt, owned by the session user, else 404;
 * 3. the flag: off (or no model client) is 503 ask-disabled, with no model call and no spend;
 * 4. the grounding (attempt row, node row, insights) and the cache key (PM1): a hit answers
 *    cached true with cost 0 and spends nothing, so it is served even above the cap;
 * 5. the reservation: the worst case of both calls, under a row lock (spend.ts); spent plus the
 *    reservation above the cap is 429 ask-cap-reached with no model call;
 * 6. the model: one call, validated (validator.ts); on failure one regeneration that names the
 *    unsupported values in a second user turn, validated again. A failed first call refunds the
 *    reservation and answers 502 with a fixed message; a failed regeneration keeps the first
 *    answer, unvalidated;
 * 7. one idempotent write (idempotentWrite): the spend settled to the real cost of the calls made
 *    and the answer stored (on conflict do nothing), committed with the Idempotency-Key's response.
 *
 * The log line carries the attempt id, cached, validated, cost and token counts; never the key, the
 * prompt, the question or the answer (PM3).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";

import type { AppConfig } from "../config.js";
import { requireDatabase } from "../http/database.js";
import { idempotentWrite } from "../http/idempotent-write.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { requireSession } from "../plugins/authenticate.js";
import type { askResultSchema } from "../schemas/explain.js";
import { requireSolverQuery } from "../solver-query/client.js";
import { findCached, questionHash, storeAnswer, type CacheKey } from "./cache.js";
import { findOwnedAttempt, loadGrounding, type GroundingBundle } from "./grounding.js";
import type { ModelClient, ModelResponse } from "./model.js";
import { costCents, worstCaseCents } from "./pricing.js";
import { ASK_MAX_TOKENS, MAX_MODEL_CALLS, REGENERATION_NOTE_MAX_CHARS, regenerationTurn, systemPrompt, userTurn } from "./prompt.js";
import { cleanQuestion } from "./question.js";
import { monthOf, reserveSpend, settleSpend } from "./spend.js";
import { askEnabled } from "./status.js";
import { validateAnswer } from "./validator.js";

export type AskResult = z.infer<typeof askResultSchema>;

export const UNVALIDATED_WARNING = "Some numbers in this answer could not be checked against the solver data.";

interface Generated {
  text: string;
  validated: boolean;
  model: string;
  calls: readonly ModelResponse[];
}

export interface AskContext {
  app: FastifyInstance;
  config: AppConfig;
  request: FastifyRequest;
  now: Date;
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
    detail: "The explanation model could not answer; nothing was charged.",
  });
}

function resultOf(attemptId: string, answer: { text: string; validated: boolean }, cached: boolean, cost: number): AskResult {
  return {
    attempt_id: attemptId,
    text: answer.text,
    validated: answer.validated,
    warning: answer.validated ? null : UNVALIDATED_WARNING,
    cached,
    cost_cents: cost,
  };
}

/** The first answer and, when it fails the validator, one regeneration (O-308). */
async function generate(model: ModelClient, bundle: GroundingBundle, question: string): Promise<Generated> {
  const system = systemPrompt(bundle.canonical);
  const first = await model.complete({ system, user: userTurn(question), maxTokens: ASK_MAX_TOKENS });
  const firstCheck = validateAnswer(first.text, bundle);
  if (firstCheck.ok) {
    return { text: first.text, validated: true, model: first.model, calls: [first] };
  }
  let second: ModelResponse;
  try {
    second = await model.complete({ system, user: regenerationTurn(question, firstCheck), maxTokens: ASK_MAX_TOKENS });
  } catch {
    // The regeneration failed after a first answer that was paid for: keep it, unvalidated.
    return { text: first.text, validated: false, model: first.model, calls: [first] };
  }
  const secondCheck = validateAnswer(second.text, bundle);
  return { text: second.text, validated: secondCheck.ok, model: second.model, calls: [first, second] };
}

function generatedCost(config: AppConfig, generated: Generated): number {
  return generated.calls.reduce((sum, call) => sum + costCents(config.askModel, call), 0);
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

/** Reserves the worst case, calls the model and settles; a failed first call refunds and is a 502. */
async function askModel(context: AskContext, model: ModelClient, bundle: GroundingBundle, question: string) {
  const database = requireDatabase(context.app);
  const month = monthOf(context.now);
  const promptChars = systemPrompt(bundle.canonical).length + userTurn(question).length + REGENERATION_NOTE_MAX_CHARS;
  const reserved = worstCaseCents(context.config.askModel, promptChars, ASK_MAX_TOKENS, MAX_MODEL_CALLS);
  if (!(await reserveSpend(database, month, reserved, context.config.askMonthlyCapCents))) {
    throw capProblem();
  }
  let generated: Generated;
  try {
    generated = await generate(model, bundle, question);
  } catch (error: unknown) {
    await settleSpend(database, month, reserved, 0);
    context.request.log.warn({ error_name: error instanceof Error ? error.name : typeof error }, "ask model call failed");
    throw modelProblem();
  }
  return { generated, month, reserved, cost: generatedCost(context.config, generated) };
}

async function storeGenerated(context: AskContext, key: CacheKey, attemptId: string, outcome: Awaited<ReturnType<typeof askModel>>) {
  const { generated, month, reserved, cost } = outcome;
  const result = resultOf(attemptId, generated, false, cost);
  try {
    return await idempotentWrite(context.app, context.request, HTTP_STATUS.ok, async (transaction) => {
      await settleSpend(transaction, month, reserved, cost);
      await storeAnswer(transaction, key, { text: generated.text, validated: generated.validated, model: generated.model, costCents: cost });
      return result;
    });
  } catch (error: unknown) {
    // The calls were made and paid for: record their real cost even though the write failed.
    await settleSpend(requireDatabase(context.app), month, reserved, cost);
    throw error;
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
  const cached = await findCached(database, key);
  if (cached !== undefined) {
    const hit = resultOf(attemptId, cached, true, 0);
    logAnswer(context, attemptId, hit, []);
    return idempotentWrite(context.app, context.request, HTTP_STATUS.ok, () => Promise.resolve(hit));
  }
  const outcome = await askModel(context, model, bundle, question);
  const result = await storeGenerated(context, key, attemptId, outcome);
  logAnswer(context, attemptId, result, outcome.generated.calls);
  return result;
}
