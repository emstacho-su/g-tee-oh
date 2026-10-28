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
import {
  heatmapSchema,
  holdoutSchema,
  leaksQuerySchema,
  leaksSchema,
  ratingSchema,
  streakSchema,
  tracksSchema,
} from "../schemas/insights.js";
import { turnRootsQuerySchema, turnRootsSchema } from "../schemas/study.js";

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

export const PLANNED_ROUTES: readonly PlannedRoute[] = [
  { method: "GET", url: "/study/turn-roots", owner: V1_5, tag: "study", summary: "Every turn root at a flop node", successStatus: 200, success: turnRootsSchema, querystring: turnRootsQuerySchema },
  // Progress, S31.
  { method: "GET", url: "/progress/rating", owner: S31, tag: "progress", summary: "The overall rank", successStatus: 200, success: ratingSchema },
  { method: "GET", url: "/progress/tracks", owner: S31, tag: "progress", summary: "Per-track ratings", successStatus: 200, success: tracksSchema },
  { method: "GET", url: "/progress/leaks", owner: S31, tag: "progress", summary: "Leak cost by spot class over recent weeks", successStatus: 200, success: leaksSchema, querystring: leaksQuerySchema },
  { method: "GET", url: "/progress/heatmap", owner: S31, tag: "progress", summary: "Mastery heat map", successStatus: 200, success: heatmapSchema },
  { method: "GET", url: "/progress/holdout", owner: S31, tag: "progress", summary: "Holdout results", successStatus: 200, success: holdoutSchema },
  { method: "GET", url: "/progress/streak", owner: S31, tag: "progress", summary: "Streak state", successStatus: 200, success: streakSchema },
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
