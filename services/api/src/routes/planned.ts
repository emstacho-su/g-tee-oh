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
import { emptyBodySchema, sessionParamsSchema } from "../schemas/common.js";
import {
  askBodySchema,
  askResultSchema,
  attemptParamsSchema,
  builderSettingsPatchSchema,
  builderSettingsSchema,
  builderStatusSchema,
  eventStreamSchema,
  heatmapSchema,
  holdoutSchema,
  leaksQuerySchema,
  leaksSchema,
  moreInfoSchema,
  ratingSchema,
  streakSchema,
  tracksSchema,
} from "../schemas/insights.js";
import {
  coverageQuerySchema,
  coverageRequestBodySchema,
  coverageRequestResultSchema,
  coverageSchema,
  studyInsightsQuerySchema,
  studyInsightsSchema,
  studyNodeQuerySchema,
  studyNodeSchema,
  turnRootsQuerySchema,
  turnRootsSchema,
} from "../schemas/study.js";
import {
  decisionBodySchema,
  feedbackSchema,
  predictionAnswerBodySchema,
  predictionParamsSchema,
  predictionPromptSchema,
  predictionResultSchema,
  promptSchema,
  rangePaintBodySchema,
  rangePaintResultSchema,
  recapSchema,
  sessionCreateBodySchema,
  sessionSchema,
} from "../schemas/training.js";

const S23 = "S23";
const S27 = "S27";
const S31 = "S31";
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

/**
 * S23's routes until each lane builds them (scaffold only): the lane route files register these
 * through registerPlannedRoutes, and the S23 integration step deletes this table.
 */
export const S23_STUBS = {
  study: [
    { method: "GET", url: "/study/node", owner: S23, tag: "study", summary: "One preflop node from the library", successStatus: 200, success: studyNodeSchema, querystring: studyNodeQuerySchema },
    { method: "GET", url: "/study/insights", owner: S23, tag: "study", summary: "Insight data for a hand at a node", successStatus: 200, success: studyInsightsSchema, querystring: studyInsightsQuerySchema },
  ],
  coverage: [
    { method: "GET", url: "/coverage", owner: S23, tag: "coverage", summary: "What the library holds for a configuration and pair", successStatus: 200, success: coverageSchema, querystring: coverageQuerySchema },
    { method: "POST", url: "/coverage/requests", owner: S23, tag: "coverage", summary: "Raise a build's priority for an uncovered spot; never starts a solve (ADR 0018)", successStatus: 202, success: coverageRequestResultSchema, body: coverageRequestBodySchema },
  ],
  sessions: [
    { method: "POST", url: "/sessions", owner: S23, tag: "sessions", summary: "Start a practice session", successStatus: 201, success: sessionSchema, body: sessionCreateBodySchema },
    { method: "GET", url: "/sessions/:id/next", owner: S23, tag: "sessions", summary: "The next prompt: table state and the buttons from the tree", successStatus: 200, success: promptSchema, params: sessionParamsSchema },
    { method: "POST", url: "/sessions/:id/decisions", owner: S23, tag: "sessions", summary: "Submit a decision and receive its feedback; a double submission is graded once", successStatus: 200, success: feedbackSchema, params: sessionParamsSchema, body: decisionBodySchema },
    { method: "POST", url: "/sessions/:id/end", owner: S23, tag: "sessions", summary: "End a session and receive its recap", successStatus: 200, success: recapSchema, params: sessionParamsSchema, body: emptyBodySchema },
  ],
  events: [
    { method: "GET", url: "/events", owner: S23, tag: "events", summary: "Server-sent events: coverage_added, builder_state, session nudges", successStatus: 200, success: eventStreamSchema, successContentType: "text/event-stream" },
  ],
  admin: [
    { method: "GET", url: "/admin/builder", owner: S23, tag: "admin", summary: "Builder queue, throughput, storage and settings", successStatus: 200, success: builderStatusSchema },
    { method: "PATCH", url: "/admin/builder/settings", owner: S23, tag: "admin", summary: "Change builder settings", successStatus: 200, success: builderSettingsSchema, body: builderSettingsPatchSchema },
    { method: "POST", url: "/admin/builder/pause", owner: S23, tag: "admin", summary: "Pause the builder", successStatus: 200, success: builderStatusSchema, body: emptyBodySchema },
    { method: "POST", url: "/admin/builder/resume", owner: S23, tag: "admin", summary: "Resume the builder", successStatus: 200, success: builderStatusSchema, body: emptyBodySchema },
  ],
} satisfies Record<string, readonly PlannedRoute[]>;

export const PLANNED_ROUTES: readonly PlannedRoute[] = [
  { method: "GET", url: "/study/turn-roots", owner: V1_5, tag: "study", summary: "Every turn root at a flop node", successStatus: 200, success: turnRootsSchema, querystring: turnRootsQuerySchema },
  // Prediction and range painting (R3.16, R3.17), S27.
  { method: "GET", url: "/prediction/:session/next", owner: S27, tag: "prediction", summary: "The next prediction prompt", successStatus: 200, success: predictionPromptSchema, params: predictionParamsSchema },
  { method: "POST", url: "/prediction/:session/answer", owner: S27, tag: "prediction", summary: "Answer a prediction prompt", successStatus: 200, success: predictionResultSchema, params: predictionParamsSchema, body: predictionAnswerBodySchema },
  { method: "POST", url: "/range-paint/submit", owner: S27, tag: "prediction", summary: "Submit a painted range for grading", successStatus: 200, success: rangePaintResultSchema, body: rangePaintBodySchema },
  // Progress, S31.
  { method: "GET", url: "/progress/rating", owner: S31, tag: "progress", summary: "The overall rank", successStatus: 200, success: ratingSchema },
  { method: "GET", url: "/progress/tracks", owner: S31, tag: "progress", summary: "Per-track ratings", successStatus: 200, success: tracksSchema },
  { method: "GET", url: "/progress/leaks", owner: S31, tag: "progress", summary: "Leak cost by spot class over recent weeks", successStatus: 200, success: leaksSchema, querystring: leaksQuerySchema },
  { method: "GET", url: "/progress/heatmap", owner: S31, tag: "progress", summary: "Mastery heat map", successStatus: 200, success: heatmapSchema },
  { method: "GET", url: "/progress/holdout", owner: S31, tag: "progress", summary: "Holdout results", successStatus: 200, success: holdoutSchema },
  { method: "GET", url: "/progress/streak", owner: S31, tag: "progress", summary: "Streak state", successStatus: 200, success: streakSchema },
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
