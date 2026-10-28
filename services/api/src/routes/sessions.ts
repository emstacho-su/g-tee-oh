/**
 * Training session routes (R3.6, R3.7, A5 section 3, A6 section 2): POST /sessions,
 * GET /sessions/{id}/next, POST /sessions/{id}/decisions and POST /sessions/{id}/end, each scoped
 * to the session user (ADR 0001). The handlers only read the request and call sessions/service.ts
 * and grading/decide.ts, where the mechanism is described.
 *
 * GET /next is pure (the S23 binding rule): it derives the prompt and writes nothing. The three
 * POST routes are the only writers; they take the CSRF token and an optional Idempotency-Key
 * (route-config.ts defaults) and write through idempotentWrite (O-232).
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { submitDecision } from "../grading/decide.js";
import { mutatingHeadersSchema } from "../http/headers.js";
import {
  AUTHENTICATED,
  MUTATE_ONE_PROBLEMS,
  UPSTREAM_MUTATE_PROBLEMS,
  UPSTREAM_READ_PROBLEMS,
} from "../http/openapi.js";
import { HTTP_STATUS, problemResponses } from "../http/problem.js";
import { requireSession } from "../plugins/authenticate.js";
import { emptyBodySchema, sessionParamsSchema } from "../schemas/common.js";
import {
  decisionBodySchema,
  feedbackSchema,
  promptSchema,
  recapSchema,
  sessionCreateBodySchema,
  sessionSchema,
} from "../schemas/training.js";
import { createSession, endSession, nextPrompt } from "../sessions/service.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

const TAG = "sessions";

/** POST /sessions also answers 501 for the modes later sessions build (O-249). */
const CREATE_PROBLEMS = [...UPSTREAM_MUTATE_PROBLEMS, HTTP_STATUS.notImplemented] as const;
/**
 * GET /next answers 409 session-ended for an ended session, and 422 no-coverage when no dealt
 * hand passes the drill's hands filter within the deal bound (sessions/deal-walk.ts).
 */
const NEXT_PROBLEMS = [...UPSTREAM_READ_PROBLEMS, HTTP_STATUS.conflict, HTTP_STATUS.unprocessable] as const;

export const sessionRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, options, done) => {
  app.post(
    "/sessions",
    {
      schema: {
        tags: [TAG],
        summary: "Start a practice session",
        description: "Drill mode in S23; automated and holdout answer 501 until S31, prediction and range_paint until S27 (O-249).",
        security: AUTHENTICATED,
        headers: mutatingHeadersSchema,
        body: sessionCreateBodySchema,
        response: { 201: sessionSchema, ...problemResponses(CREATE_PROBLEMS) },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);
      const session = await createSession({ app, request, userId }, request.body);
      return reply.code(HTTP_STATUS.created).send(session);
    },
  );

  app.get(
    "/sessions/:id/next",
    {
      schema: {
        tags: [TAG],
        summary: "The next prompt: table state and the buttons from the tree",
        description: "Derived from the session state on every call; writes nothing, so a repeat answers the same prompt.",
        security: AUTHENTICATED,
        params: sessionParamsSchema,
        response: { 200: promptSchema, ...problemResponses(NEXT_PROBLEMS) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      return nextPrompt({ app, request, userId }, request.params.id);
    },
  );

  app.post(
    "/sessions/:id/decisions",
    {
      schema: {
        tags: [TAG],
        summary: "Submit a decision and receive its feedback; a double submission is graded once",
        security: AUTHENTICATED,
        headers: mutatingHeadersSchema,
        params: sessionParamsSchema,
        body: decisionBodySchema,
        response: { 200: feedbackSchema, ...problemResponses(UPSTREAM_MUTATE_PROBLEMS) },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);
      return submitDecision({
        app,
        request,
        reply,
        config: options.config,
        userId,
        sessionId: request.params.id,
        body: request.body,
        now: new Date(),
      });
    },
  );

  app.post(
    "/sessions/:id/end",
    {
      schema: {
        tags: [TAG],
        summary: "End a session and receive its recap",
        security: AUTHENTICATED,
        headers: mutatingHeadersSchema,
        params: sessionParamsSchema,
        body: emptyBodySchema,
        response: { 200: recapSchema, ...problemResponses(MUTATE_ONE_PROBLEMS) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      return endSession({ app, request, userId }, request.params.id);
    },
  );

  done();
};
