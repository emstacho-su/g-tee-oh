/**
 * The rest of the v1 api surface (A5 section 3), declared by S21 so the committed contract covers
 * every route before its session builds it (O-38). Each route carries its full request and
 * response schemas and answers a 501 problem naming its owner until then. An owner replaces its
 * entries here with a real route file; the contract diff shows what changed.
 */
import type { FastifySchema } from "fastify";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { mutatingHeadersSchema } from "../http/headers.js";
import { notImplemented, plannedDescription } from "../http/not-implemented.js";
import { AUTHENTICATED, PLANNED_MUTATE_PROBLEMS, PLANNED_READ_PROBLEMS } from "../http/openapi.js";
import { problemResponses } from "../http/problem.js";
import { askBodySchema, askResultSchema, attemptParamsSchema, moreInfoSchema } from "../schemas/insights.js";
import { turnRootsQuerySchema, turnRootsSchema } from "../schemas/study.js";
import {
  predictionAnswerBodySchema,
  predictionParamsSchema,
  predictionPromptSchema,
  predictionResultSchema,
  rangePaintBodySchema,
  rangePaintResultSchema,
} from "../schemas/training.js";

const S27 = "S27";
const V1_5 = "a v1.5 session (O-15)";

type Method = "GET" | "POST" | "PATCH";

export interface PlannedRoute {
  method: Method;
  url: string;
  owner: string;
  tag: string;
  summary: string;
  successStatus: 200 | 201 | 202;
  success: z.ZodType;
  querystring?: z.ZodType;
  params?: z.ZodType;
  body?: z.ZodType;
  /** The success body's media type when it is not JSON (the event stream). */
  successContentType?: string;
}

export const PLANNED_ROUTES: readonly PlannedRoute[] = [
  { method: "GET", url: "/study/turn-roots", owner: V1_5, tag: "study", summary: "Every turn root at a flop node", successStatus: 200, success: turnRootsSchema, querystring: turnRootsQuerySchema },
  // Prediction and range painting (R3.16, R3.17), S27.
  { method: "GET", url: "/prediction/:session/next", owner: S27, tag: "prediction", summary: "The next prediction prompt", successStatus: 200, success: predictionPromptSchema, params: predictionParamsSchema },
  { method: "POST", url: "/prediction/:session/answer", owner: S27, tag: "prediction", summary: "Answer a prediction prompt", successStatus: 200, success: predictionResultSchema, params: predictionParamsSchema, body: predictionAnswerBodySchema },
  { method: "POST", url: "/range-paint/submit", owner: S27, tag: "prediction", summary: "Submit a painted range for grading", successStatus: 200, success: rangePaintResultSchema, body: rangePaintBodySchema },
  // Progress moved to routes/progress.ts (S31, R4.12).
  // Explanations (R3.19, R3.20), S27.
  { method: "GET", url: "/explain/:attempt_id/more-info", owner: S27, tag: "explain", summary: "The templated explanation of an attempt", successStatus: 200, success: moreInfoSchema, params: attemptParamsSchema },
  { method: "POST", url: "/explain/:attempt_id/ask", owner: S27, tag: "explain", summary: "Ask the model about an attempt, behind a feature flag (O-54)", successStatus: 200, success: askResultSchema, params: attemptParamsSchema, body: askBodySchema },
];

function successResponse(route: PlannedRoute) {
  if (route.successContentType === undefined) {
    return route.success;
  }
  return { description: route.summary, content: { [route.successContentType]: { schema: route.success } } };
}

function routeSchema(route: PlannedRoute): FastifySchema & { hide?: boolean; tags: string[] } {
  const mutating = route.method !== "GET";
  return {
    tags: [route.tag],
    summary: route.summary,
    description: plannedDescription(route.owner, route.summary),
    security: AUTHENTICATED,
    ...(mutating ? { headers: mutatingHeadersSchema } : {}),
    ...(route.querystring === undefined ? {} : { querystring: route.querystring }),
    ...(route.params === undefined ? {} : { params: route.params }),
    ...(route.body === undefined ? {} : { body: route.body }),
    response: {
      [route.successStatus]: successResponse(route),
      ...problemResponses(mutating ? PLANNED_MUTATE_PROBLEMS : PLANNED_READ_PROBLEMS),
    },
  };
}

type PluginApp = Parameters<FastifyPluginCallbackZod>[0];

export const plannedRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  registerPlannedRoutes(app, PLANNED_ROUTES);
  done();
};

/** Registers routes that answer a 501 problem naming their owner (O-38). */
export function registerPlannedRoutes(app: PluginApp, routes: readonly PlannedRoute[]): void {
  for (const route of routes) {
    app.route({
      method: route.method,
      url: route.url,
      config: { owner: route.owner },
      schema: routeSchema(route),
      handler: (request) => notImplemented(request),
    });
  }
}
