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

const PROGRESS_PATHS = ["rating", "tracks", "leaks", "heatmap", "holdout", "streak"] as const;
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
  it("R4.12 each progress route answers 501 naming S31 for a signed-in user and 401 without one", async () => {
    for (const path of PROGRESS_PATHS) {
      const url = `/api/v1/progress/${path}`;
      const response = await app.inject({ method: "GET", url, headers: readHeaders(session) });
      expect(response.statusCode, path).toBe(501);
      expect(response.json<{ detail: string }>().detail, path).toContain("S31");
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
  it("R4.10 automated with a scope and holdout with a track parse and answer 501 naming S31", async () => {
    const automated = await createSession({ mode: "automated", config_ids: [CONFIG] });
    expect(automated.statusCode, automated.body).toBe(501);
    expect(automated.json<{ detail: string }>().detail).toContain("S31");
    const holdout = await createSession({ mode: "holdout", track_key: "blind-defense" });
    expect(holdout.statusCode, holdout.body).toBe(501);
    expect(holdout.json<{ detail: string }>().detail).toContain("S31");
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
