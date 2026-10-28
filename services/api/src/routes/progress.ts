/**
 * Progress routes (R4.12, A5 section 3, O-271 to O-279): GET /progress/rating, /tracks, /leaks,
 * /heatmap, /holdout and /streak, each scoped to the session user (ADR 0001) and each a pure read
 * (nothing here writes; streaks and tiers are recomputed on read, O-252, O-278).
 *
 * S31's contract commit registers every route with its final request and response schemas; the
 * handlers answer a 501 problem naming S31 until the progress lane fills them (progress/*), so the
 * committed document is complete before the handlers exist (O-38). The lane replaces each handler
 * body and drops 501 from PROGRESS_PROBLEMS.
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { notImplemented, plannedDescription } from "../http/not-implemented.js";
import { AUTHENTICATED, READ_PROBLEMS } from "../http/openapi.js";
import { HTTP_STATUS, problemResponses } from "../http/problem.js";
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

const TAG = "progress";
/** The session that builds these handlers (O-38). */
export const PROGRESS_OWNER = "S31";
/** An authenticated read, plus 501 while the handler is a placeholder. */
const PROGRESS_PROBLEMS = [...READ_PROBLEMS, HTTP_STATUS.notImplemented] as const;

function describe(summary: string): { summary: string; description: string } {
  return { summary, description: plannedDescription(PROGRESS_OWNER, summary) };
}

export const progressRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const config = { owner: PROGRESS_OWNER };

  app.get(
    "/progress/rating",
    {
      config,
      schema: {
        tags: [TAG],
        ...describe("The overall rank: weighted rating, deviation band and tier"),
        security: AUTHENTICATED,
        response: { 200: ratingSchema, ...problemResponses(PROGRESS_PROBLEMS) },
      },
    },
    (request) => notImplemented(request),
  );

  app.get(
    "/progress/tracks",
    {
      config,
      schema: {
        tags: [TAG],
        ...describe("Per-track ratings with their effective weights"),
        security: AUTHENTICATED,
        querystring: tracksQuerySchema,
        response: { 200: tracksSchema, ...problemResponses(PROGRESS_PROBLEMS) },
      },
    },
    (request) => notImplemented(request),
  );

  app.get(
    "/progress/leaks",
    {
      config,
      schema: {
        tags: [TAG],
        ...describe("The top leaks by spot class with their weekly series"),
        security: AUTHENTICATED,
        querystring: leaksQuerySchema,
        response: { 200: leaksSchema, ...problemResponses(PROGRESS_PROBLEMS) },
      },
    },
    (request) => notImplemented(request),
  );

  app.get(
    "/progress/heatmap",
    {
      config,
      schema: {
        tags: [TAG],
        ...describe("Mastery heat map: family by pair against depth band by format"),
        security: AUTHENTICATED,
        response: { 200: heatmapSchema, ...problemResponses(PROGRESS_PROBLEMS) },
      },
    },
    (request) => notImplemented(request),
  );

  app.get(
    "/progress/holdout",
    {
      config,
      schema: {
        tags: [TAG],
        ...describe("Monthly holdout retest rounds, newest first, and the open round"),
        security: AUTHENTICATED,
        querystring: holdoutQuerySchema,
        response: { 200: holdoutSchema, ...problemResponses(PROGRESS_PROBLEMS) },
      },
    },
    (request) => notImplemented(request),
  );

  app.get(
    "/progress/streak",
    {
      config,
      schema: {
        tags: [TAG],
        ...describe("Streak state: days, freezes, the repair window and cosmetic unlocks"),
        security: AUTHENTICATED,
        response: { 200: streakSchema, ...problemResponses(PROGRESS_PROBLEMS) },
      },
    },
    (request) => notImplemented(request),
  );

  done();
};
