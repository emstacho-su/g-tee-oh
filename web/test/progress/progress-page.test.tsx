// /progress through the whole app (S32, R4.12, O-321, O-326): the six cards over a fake fetch,
// per-card error with Try again, the weeks selector, and click to drill from the heat map and
// the leak trend (find by tag, create when missing, no matching configuration).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { drillListKey } from "../../src/drills/queries.js";
import { fixtureDrill } from "../../src/fixtures/trainer.js";
import { fixtureConfigs } from "../../src/fixtures/study.js";
import {
  fixtureFreshHeatmap,
  fixtureFreshHoldout,
  fixtureFreshLeaks,
  fixtureFreshRating,
  fixtureFreshStreak,
  fixtureFreshTracks,
  fixtureHeatmap,
  fixtureHoldout,
  fixtureLeaks,
  fixtureRating,
  fixtureStreak,
  fixtureTracks,
} from "../../src/fixtures/progress.js";
import { jsonResponse, problemResponse, type FetchScript } from "../api/fake-fetch.js";
import { renderApp, SIGNED_IN } from "../app/render-app.js";

const PROGRESS: FetchScript = {
  ...SIGNED_IN,
  "GET /api/v1/progress/rating": [jsonResponse(200, fixtureRating)],
  "GET /api/v1/progress/tracks": [jsonResponse(200, { items: fixtureTracks, next_cursor: null })],
  "GET /api/v1/progress/leaks": [jsonResponse(200, fixtureLeaks)],
  "GET /api/v1/progress/heatmap": [jsonResponse(200, fixtureHeatmap)],
  "GET /api/v1/progress/holdout": [jsonResponse(200, fixtureHoldout)],
  "GET /api/v1/progress/streak": [jsonResponse(200, fixtureStreak)],
};

const FRESH: FetchScript = {
  ...SIGNED_IN,
  "GET /api/v1/progress/rating": [jsonResponse(200, fixtureFreshRating)],
  "GET /api/v1/progress/tracks": [jsonResponse(200, { items: fixtureFreshTracks, next_cursor: null })],
  "GET /api/v1/progress/leaks": [jsonResponse(200, fixtureFreshLeaks)],
  "GET /api/v1/progress/heatmap": [jsonResponse(200, fixtureFreshHeatmap)],
  "GET /api/v1/progress/holdout": [jsonResponse(200, fixtureFreshHoldout)],
  "GET /api/v1/progress/streak": [jsonResponse(200, fixtureFreshStreak)],
};

const NO_DRILLS = jsonResponse(200, { items: [], next_cursor: null });
const CONFIGS = jsonResponse(200, { items: fixtureConfigs, next_cursor: null });
const CREATED_ID = "00000000-0000-4000-8000-0000000000ab";

describe("R4.12 /progress", () => {
  it("R4.12 R4.14 the streak card names the next milestone's cosmetic as home does, never by its key", async () => {
    renderApp("/progress", PROGRESS);
    const next = await screen.findByTestId("streak-next");
    expect(next).toHaveTextContent("Next: 30 days unlocks Thirty-day streak badge.");
    expect(next).not.toHaveTextContent("badge-streak-30");
  });

  it("R4.12 shows the rating, streak, tracks, leak trend, heat map and holdout cards", async () => {
    renderApp("/progress", PROGRESS);
    expect(await screen.findByRole("heading", { level: 1, name: "Progress" })).toBeInTheDocument();
    expect(await screen.findByTestId("rating-value")).toHaveTextContent("1612");
    expect(await screen.findByTestId("streak-current")).toHaveTextContent("9 days");
    expect(await screen.findAllByTestId("track-row")).toHaveLength(7);
    expect(await screen.findAllByTestId("leak-row")).toHaveLength(10);
    expect(await screen.findAllByTestId("heat-cell")).toHaveLength(40);
    expect(await screen.findByTestId("goodhart-flag")).toBeInTheDocument();
    // The tracks read names the tracks on the rating card's blocked-by note and the holdout card.
    expect(await screen.findByTestId("rating-blocked")).toHaveTextContent("Live limped and straddled pots");
    expect(screen.getAllByTestId("holdout-track")[0]).toHaveTextContent("Opens (September 2026)");
  });

  it("R4.12 a fresh learner sees the empty states", async () => {
    renderApp("/progress", FRESH);
    expect(await screen.findByText("No leaks yet: finish an automated session to see where you lose the most")).toBeInTheDocument();
    expect(await screen.findByText("No holdout round yet")).toBeInTheDocument();
    expect(await screen.findByTestId("rating-value")).toHaveTextContent("Unrated");
    const cells = await screen.findAllByTestId("heat-cell");
    expect(cells.every((cell) => cell.getAttribute("data-state") === "new")).toBe(true);
  });

  it("R4.12 the holdout card starts the retest, or resumes it while a round is open (O-328)", async () => {
    const { router } = renderApp("/progress", FRESH);
    const start = await screen.findByTestId("holdout-retest");
    expect(start).toHaveTextContent("Start");
    fireEvent.click(start);
    await waitFor(() => expect(router.state.location.pathname).toBe("/train"));
    expect(router.state.location.search).toEqual({ mode: "holdout" });
  });

  it("R4.12 an open holdout round offers to resume the retest (O-328)", async () => {
    renderApp("/progress", PROGRESS);
    expect(await screen.findByTestId("holdout-retest")).toHaveTextContent("Resume");
  });

  it("R4.12 a round with every item answered hides the resume link and says the retest is complete (O-328)", async () => {
    renderApp("/progress", { ...PROGRESS, "GET /api/v1/progress/holdout": [jsonResponse(200, { ...fixtureHoldout, open: { round_month: "2026-10-01", answered: 30, total: 30 } })] });
    expect(await screen.findByTestId("holdout-retest-complete")).toBeInTheDocument();
    expect(screen.queryByTestId("holdout-retest")).not.toBeInTheDocument();
  });

  it("R4.12 a failed card shows its own error and Try again reloads only that read", async () => {
    const { fake } = renderApp("/progress", {
      ...PROGRESS,
      "GET /api/v1/progress/holdout": [problemResponse(503, "unavailable"), jsonResponse(200, fixtureHoldout)],
    });
    const card = await screen.findByTestId("holdout-card");
    expect(await within(card).findByRole("alert")).toHaveTextContent("Could not load the holdout rounds.");
    expect(await screen.findAllByTestId("leak-row")).toHaveLength(10);
    fireEvent.click(within(card).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("goodhart-flag")).toBeInTheDocument();
    expect(fake.keys().filter((key) => key === "GET /api/v1/progress/holdout")).toHaveLength(2);
    expect(fake.keys().filter((key) => key === "GET /api/v1/progress/rating")).toHaveLength(1);
  });

  it("R4.12 the cards show a loading note until their read answers", async () => {
    renderApp("/progress", { ...PROGRESS, "GET /api/v1/progress/streak": [() => new Promise<Response>(() => undefined)] });
    expect(await screen.findByText("Loading the streak")).toBeInTheDocument();
  });

  it("R4.12 choosing 26 weeks reads the trend again for 26 weeks", async () => {
    const { fake } = renderApp("/progress", PROGRESS);
    await screen.findAllByTestId("leak-row");
    fireEvent.click(screen.getByRole("radio", { name: "26 weeks" }));
    await waitFor(() => expect(fake.keys().filter((key) => key === "GET /api/v1/progress/leaks")).toHaveLength(2));
    expect(screen.getByRole("radio", { name: "26 weeks" })).toHaveAttribute("aria-checked", "true");
  });

  it("R4.12 a heat map cell opens the class's existing auto drill (O-321)", async () => {
    const { router, fake } = renderApp("/progress", { ...PROGRESS, "GET /api/v1/drills": [jsonResponse(200, { items: [fixtureDrill], next_cursor: null })] });
    fireEvent.click(await screen.findByRole("button", { name: /^rfi BB-UTG, live 100 bb:/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/drills/${fixtureDrill.id}/run`));
    expect(fake.keys()).not.toContain("POST /api/v1/drills");
  });

  it("R4.12 a leak row creates the class's drill when none exists, then opens it and drops the cached drill lists", async () => {
    const { router, fake, queryClient } = renderApp("/progress", {
      ...PROGRESS,
      "GET /api/v1/drills": [NO_DRILLS],
      "GET /api/v1/configs": [CONFIGS],
      "POST /api/v1/drills": [jsonResponse(201, { ...fixtureDrill, id: CREATED_ID })],
      [`GET /api/v1/drills/${CREATED_ID}`]: [jsonResponse(200, { ...fixtureDrill, id: CREATED_ID })],
    });
    queryClient.setQueryData(drillListKey(undefined), { pages: [], pageParams: [] });
    fireEvent.click(await screen.findByRole("button", { name: "Drill this spot: rfi BB-UTG, live 100 bb" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/drills/${CREATED_ID}/run`));
    const post = fake.calls.find((call) => call.method === "POST" && call.path === "/api/v1/drills");
    expect(JSON.parse(post?.body ?? "{}")).toMatchObject({ name: "Leak drill: rfi BB-UTG live 100" });
    expect(queryClient.getQueryState(drillListKey(undefined))?.isInvalidated).toBe(true);
  });

  it("R4.12 a class no configuration covers says so in its card and creates nothing", async () => {
    const { fake } = renderApp("/progress", { ...PROGRESS, "GET /api/v1/drills": [NO_DRILLS], "GET /api/v1/configs": [CONFIGS] });
    fireEvent.click(await screen.findByRole("button", { name: /^rfi BB-UTG, online 150 bb:/ }));
    const card = screen.getByTestId("mastery-heatmap");
    expect(await within(card).findByRole("alert")).toHaveTextContent("No covered configuration matches this spot");
    expect(within(screen.getByTestId("leak-trend")).queryByRole("alert")).toBeNull();
    expect(fake.keys()).not.toContain("POST /api/v1/drills");
  });

  it("R4.12 the clicked drill button is disabled while its drill opens, and a second click waits", async () => {
    const { fake } = renderApp("/progress", { ...PROGRESS, "GET /api/v1/drills": [() => new Promise<Response>(() => undefined)] });
    const button = await screen.findByRole("button", { name: "Drill this spot: rfi BB-UTG, live 100 bb" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveTextContent("Opening");
    fireEvent.click(screen.getByRole("button", { name: "Drill this spot: rfi BB-CO, live 100 bb" }));
    await waitFor(() => expect(fake.keys().filter((key) => key === "GET /api/v1/drills")).toHaveLength(1));
  });

  it("R4.12 a failed drill lookup shows the problem's title inline", async () => {
    renderApp("/progress", { ...PROGRESS, "GET /api/v1/drills": [problemResponse(500, "internal")] });
    fireEvent.click(await screen.findByRole("button", { name: "Drill this spot: rfi BB-UTG, live 100 bb" }));
    const card = screen.getByTestId("leak-trend");
    expect(await within(card).findByRole("alert")).toHaveTextContent("Could not open a drill: title of internal.");
    expect(within(card).getByRole("button", { name: "Drill this spot: rfi BB-UTG, live 100 bb" })).toBeEnabled();
  });
});
