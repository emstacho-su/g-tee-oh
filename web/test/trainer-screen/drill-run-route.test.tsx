/**
 * The /drills/$id/run route renders the trainer screen through the whole app (S25, R3.13, O-288):
 * the validated seed reaches POST /sessions, and a malformed seed is dropped before the screen.
 */
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FIXTURE_DRILL_ID, FIXTURE_SEED, fixtureDrill, fixturePlainPrompt, fixturePracticeSession } from "../../src/fixtures/trainer.js";
import { jsonResponse } from "../api/fake-fetch.js";
import { SIGNED_IN, renderApp } from "../app/render-app.js";

const SCRIPT = {
  ...SIGNED_IN,
  [`GET /api/v1/drills/${FIXTURE_DRILL_ID}`]: [jsonResponse(200, fixtureDrill)],
  "POST /api/v1/sessions": [jsonResponse(201, fixturePracticeSession)],
  [`GET /api/v1/sessions/${fixturePracticeSession.session_id}/next`]: [jsonResponse(200, fixturePlainPrompt)],
};

async function startedBody(path: string): Promise<unknown> {
  const app = renderApp(path, SCRIPT);
  await userEvent.click(await screen.findByRole("button", { name: "Start session" }));
  await screen.findByRole("group", { name: "Actions" });
  const start = app.fake.calls.find((call) => call.method === "POST" && call.path === "/api/v1/sessions");
  return JSON.parse(start?.body ?? "null") as unknown;
}

describe("R3.13 drill run route", () => {
  it("R3.13 the seed search parameter is sent with the session start (O-288)", async () => {
    expect(await startedBody(`/drills/${FIXTURE_DRILL_ID}/run?seed=${FIXTURE_SEED}`)).toMatchObject({ seed: FIXTURE_SEED });
  });

  it("R3.13 a malformed seed is dropped by the route's validation", async () => {
    expect(await startedBody(`/drills/${FIXTURE_DRILL_ID}/run?seed=XYZ`)).not.toHaveProperty("seed");
  });
});
