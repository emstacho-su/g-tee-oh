/**
 * The /drills/$id/run route renders the trainer screen through the whole app (S25, R3.13, O-288):
 * the validated seed reaches POST /sessions, and a malformed seed is dropped before the screen.
 */
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FIXTURE_DRILL_ID, FIXTURE_SEED, fixtureDrill, fixturePlainPrompt, fixturePracticeSession } from "../../src/fixtures/trainer.js";
import { validateDrillRunSearch } from "../../src/trainer/run-search.js";
import { drillQuery } from "../../src/trainer/session-api.js";
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

  it("R3.36 ?start=1 starts the session after the drill read and is dropped from the address (O-484)", async () => {
    const app = renderApp(`/drills/${FIXTURE_DRILL_ID}/run?start=1`, SCRIPT);
    await screen.findByRole("group", { name: "Actions" });
    const isStart = (call: { method: string; path: string }) => call.method === "POST" && call.path === "/api/v1/sessions";
    expect(app.fake.calls.filter(isStart)).toHaveLength(1);
    const drillRead = app.fake.calls.findIndex((call) => call.method === "GET" && call.path === `/api/v1/drills/${FIXTURE_DRILL_ID}`);
    expect(drillRead).toBeGreaterThanOrEqual(0);
    expect(drillRead).toBeLessThan(app.fake.calls.findIndex(isStart));
    await waitFor(() => expect(app.router.state.location.search).not.toHaveProperty("start"));
  });

  it("R4.12 from=leak-created says Opened Leak drill, created", async () => {
    const leakDrill = { ...fixtureDrill, name: "Leak drill: open or fold, big blind versus under the gun, live 100bb" };
    const app = renderApp(`/drills/${FIXTURE_DRILL_ID}/run?from=leak-created`, { ...SCRIPT, [`GET /api/v1/drills/${FIXTURE_DRILL_ID}`]: [jsonResponse(200, leakDrill)] });
    expect(await screen.findByTestId("opened-note")).toHaveTextContent("Opened Leak drill: open or fold, big blind versus under the gun, live 100bb, created for this spot.");
    // Said once: the flag leaves the address, so a reload or a copied link does not say it again.
    await waitFor(() => expect(app.router.state.location.search).not.toHaveProperty("from"));
    expect(screen.getByTestId("opened-note")).toBeInTheDocument();
  });

  it("R4.12 from=leak-reused says the drill was already there, and an unknown from says nothing", async () => {
    renderApp(`/drills/${FIXTURE_DRILL_ID}/run?from=leak-reused`, SCRIPT);
    expect(await screen.findByTestId("opened-note")).toHaveTextContent(`Opened ${fixtureDrill.name}, already in your drills.`);
    expect(validateDrillRunSearch({ from: "leak-created" })).toEqual({ from: "leak-created" });
    expect(validateDrillRunSearch({ from: "elsewhere" })).toEqual({});
  });

  it("R3.36 start=yes is not an autostart", async () => {
    const app = renderApp(`/drills/${FIXTURE_DRILL_ID}/run?start=yes`, SCRIPT);
    await screen.findByRole("button", { name: "Start session" });
    expect(app.fake.calls.filter((call) => call.method === "POST" && call.path === "/api/v1/sessions")).toHaveLength(0);
  });

  it("R3.36 autostart waits for a stale cached drill's refetch and starts with the refetched settings (PR #48 review round 2 HIGH 1)", async () => {
    const changed = { ...fixtureDrill, trainer: { ...fixtureDrill.trainer, rng: true } };
    const app = renderApp(`/drills/${FIXTURE_DRILL_ID}/run`, {
      ...SCRIPT,
      [`GET /api/v1/drills/${FIXTURE_DRILL_ID}`]: [jsonResponse(200, fixtureDrill), jsonResponse(200, changed)],
    });
    expect(await screen.findByRole("switch", { name: "Mixed-frequency mode" })).toHaveAttribute("aria-checked", "false");
    await app.router.navigate({ to: "/settings/$section", params: { section: "hotkeys" } });
    await app.queryClient.invalidateQueries({ queryKey: drillQuery(app.api, FIXTURE_DRILL_ID).queryKey });
    await app.router.navigate({ to: "/drills/$id/run", params: { id: FIXTURE_DRILL_ID }, search: { start: "1" } });
    await screen.findByRole("group", { name: "Actions" });
    const start = app.fake.calls.find((call) => call.method === "POST" && call.path === "/api/v1/sessions");
    expect(JSON.parse(start?.body ?? "{}")).toMatchObject({ settings: { rng: true } });
  });
});
