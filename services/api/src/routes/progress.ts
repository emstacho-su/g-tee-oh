/**
 * Progress routes (R4.12, A5 section 3, O-271 to O-279): GET /progress/rating, /tracks, /leaks,
 * /heatmap, /holdout, /streak and S41's /frequencies (O-353), each scoped to the session user (ADR 0001; 401 without one) and
 * each a pure read: nothing here writes, and streaks, tiers and effective weights are recomputed on
 * every read (O-252, O-278). The handlers only read the request and call progress/service.ts, where
 * the mechanism is described. The rating, tracks, leaks and heat map read solver-query's class
 * catalog, so they also answer the upstream problems (502, 503); holdout and streak read only the
 * database. Days and weeks are APP_TIME_ZONE's (O-247).
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { AUTHENTICATED, READ_PROBLEMS, UPSTREAM_READ_PROBLEMS } from "../http/openapi.js";
import { problemResponses } from "../http/problem.js";
import { requireSession } from "../plugins/authenticate.js";
import {
  heatmapProgress,
  holdoutProgress,
  leaksProgress,
  ratingProgress,
  streakProgress,
  tracksProgress,
  type ProgressCall,
} from "../progress/service.js";
import {
  heatmapSchema,
  holdoutQuerySchema,
  holdoutSchema,
  leaksQuerySchema,
  leaksSchema,
  ratingSchema,
  streakSchema,
  tracksQuerySchema,
  tracksSchema,
} from "../schemas/insights.js";
import { frequencyProgress } from "../progress/frequencies.js";
import { frequencyComparisonSchema } from "../schemas/frequencies.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

const TAG = "progress";

export const progressRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, options, done) => {
  const callOf = (request: Parameters<typeof requireSession>[0]): ProgressCall => ({
    app,
    userId: requireSession(request).userId,
    now: new Date(),
    timeZone: options.config.timeZone,
  });

  app.get(
    "/progress/rating",
    {
      schema: {
        tags: [TAG],
        summary: "The overall rank: weighted rating, deviation band and tier",
        description: "Recomputed on every read from the track ratings with inactivity applied and the effective track weights (O-252, O-271).",
        security: AUTHENTICATED,
        response: { 200: ratingSchema, ...problemResponses(UPSTREAM_READ_PROBLEMS) },
      },
    },
    (request) => ratingProgress(callOf(request)),
  );

  app.get(
    "/progress/tracks",
    {
      schema: {
        tags: [TAG],
        summary: "Per-track ratings with their effective weights",
        security: AUTHENTICATED,
        querystring: tracksQuerySchema,
        response: { 200: tracksSchema, ...problemResponses(UPSTREAM_READ_PROBLEMS) },
      },
    },
    (request) => tracksProgress(callOf(request), request.query),
  );

  app.get(
    "/progress/leaks",
    {
      schema: {
        tags: [TAG],
        summary: "The top leaks by spot class with their weekly series",
        security: AUTHENTICATED,
        querystring: leaksQuerySchema,
        response: { 200: leaksSchema, ...problemResponses(UPSTREAM_READ_PROBLEMS) },
      },
    },
    (request) => leaksProgress(callOf(request), request.query.weeks),
  );

  app.get(
    "/progress/heatmap",
    {
      schema: {
        tags: [TAG],
        summary: "Mastery heat map: family by pair against depth band by format",
        security: AUTHENTICATED,
        response: { 200: heatmapSchema, ...problemResponses(UPSTREAM_READ_PROBLEMS) },
      },
    },
    (request) => heatmapProgress(callOf(request)),
  );

  app.get(
    "/progress/holdout",
    {
      schema: {
        tags: [TAG],
        summary: "Monthly holdout retest rounds, newest first, and the open round",
        security: AUTHENTICATED,
        querystring: holdoutQuerySchema,
        response: { 200: holdoutSchema, ...problemResponses(READ_PROBLEMS) },
      },
    },
    (request) => holdoutProgress(callOf(request), request.query),
  );

  app.get(
    "/progress/streak",
    {
      schema: {
        tags: [TAG],
        summary: "Streak state: days, freezes, the repair window and cosmetic unlocks",
        security: AUTHENTICATED,
        response: { 200: streakSchema, ...problemResponses(READ_PROBLEMS) },
      },
    },
    (request) => streakProgress(callOf(request)),
  );

  app.get(
    "/progress/frequencies",
    {
      schema: {
        tags: [TAG],
        summary: "Your preflop action frequencies against the solver's, per node and hand class",
        description:
          "Counted decisions only (no holdout, client-seeded or answer-revealing-panel decisions), preflop only, the 12 most played nodes, shown from a minimum sample (O-353, O-417, O-418). Labels come from one solver-query node read per spot, so it also answers the upstream problems.",
        security: AUTHENTICATED,
        response: { 200: frequencyComparisonSchema, ...problemResponses(UPSTREAM_READ_PROBLEMS) },
      },
    },
    (request) => frequencyProgress({ app, request, userId: requireSession(request).userId }),
  );

  done();
};
