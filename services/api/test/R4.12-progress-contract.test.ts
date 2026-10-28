/**
 * S31's contract commit (R4.12, R4.10, O-38): the six progress routes are registered with their
 * final schemas and answer a 501 problem naming S31 until the progress lane builds them, and
 * POST /sessions accepts the automated scope and the holdout track (automated and holdout still
 * answer 501 naming S31 until their lanes land), rejecting a malformed one with 400.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { MAX_SESSION_CONFIG_IDS } from "../src/schemas/training.js";
import { buildTestApp, mutatingHeaders, readHeaders } from "./support/app.js";
import { appDatabase, createTestSession, createTestUser, type TestSession } from "./support/database.js";

// S41 added frequencies (O-353): with no decisions it reads no solver-query node, so it answers 200 here.
const PROGRESS_PATHS = ["rating", "tracks", "leaks", "heatmap", "holdout", "streak", "frequencies"] as const;
const CONFIG = "cfg_6_online_100";

let database: Database;
let app: ApiApp;
let session: TestSession;

beforeAll(async () => {
  database = appDatabase();
  app = buildTestApp(database);
  await app.ready();
  const user = await createTestUser(database);
  session = await createTestSession(database, user.id);
});

afterAll(async () => {
  await app.close();
  await database.destroy();
});

function createSession(payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/v1/sessions", headers: mutatingHeaders(session), payload });
}

describe("R4.12 progress routes in the contract", () => {
  it("R4.12 each progress route is built (no 501) for a signed-in user and 401 without one", async () => {
    // S31 Lane C: the handlers are real now. This app has no solver-query, so the routes that read
    // the class catalog (tracks, leaks, heatmap) are a 503; the rest answer 200 (R4.12-progress-routes covers the bodies).
    const catalogRoutes: readonly string[] = ["tracks", "leaks", "heatmap"];
    for (const path of PROGRESS_PATHS) {
      const url = `/api/v1/progress/${path}`;
      const response = await app.inject({ method: "GET", url, headers: readHeaders(session) });
      expect(response.statusCode, path).toBe(catalogRoutes.includes(path) ? 503 : 200);
      const anonymous = await app.inject({ method: "GET", url });
      expect(anonymous.statusCode, path).toBe(401);
    }
  });

  it("R4.12 the query schemas bound weeks and the page limit", async () => {
    const weeks = await app.inject({ method: "GET", url: "/api/v1/progress/leaks?weeks=53", headers: readHeaders(session) });
    expect(weeks.statusCode).toBe(400);
    const limit = await app.inject({ method: "GET", url: "/api/v1/progress/tracks?limit=0", headers: readHeaders(session) });
    expect(limit.statusCode).toBe(400);
  });
});

describe("R4.10 POST /sessions body fields", () => {
  it("R4.10 automated with a scope and holdout with a track parse; automated reaches its lane (503 here, no solver-query)", async () => {
    // S31 Lane A: automated sessions are built now; this app has no solver-query, so a parsed body is a 503.
    const automated = await createSession({ mode: "automated", config_ids: [CONFIG] });
    expect(automated.statusCode, automated.body).toBe(503);
    // S31 Lane C: holdout sessions are built now; without solver-query a parsed body is a 503 as well.
    const holdout = await createSession({ mode: "holdout", track_key: "blind-defense" });
    expect(holdout.statusCode, holdout.body).toBe(503);
  });

  it("R4.10 an unknown track, an empty or oversized scope and a malformed configuration are 400", async () => {
    const oversized = Array.from({ length: MAX_SESSION_CONFIG_IDS + 1 }, () => CONFIG);
    for (const body of [
      { mode: "holdout", track_key: "postflop" },
      { mode: "automated", config_ids: [] },
      { mode: "automated", config_ids: oversized },
      { mode: "automated", config_ids: ["not a config"] },
    ]) {
      const response = await createSession(body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
    }
  });
});
