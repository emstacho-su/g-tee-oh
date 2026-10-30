/**
 * The home screen through the whole app (S32, R4.12, R4.14, O-322, O-323): today's queue, the
 * streak tile and the rating card for a seasoned and a fresh learner, the equipped badge shown
 * only while unlocked, and each card's loading, error and Try again states.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  fixtureFreshHeatmap,
  fixtureFreshLeaks,
  fixtureFreshRating,
  fixtureFreshStreak,
  fixtureFreshTracks,
  fixtureHeatmap,
  fixtureLeaks,
  fixtureRating,
  fixtureStreak,
  fixtureTracks,
} from "../../src/fixtures/progress.js";
import { defaultHotkeyStore } from "../../src/hotkeys/index.js";
import { NO_CLASSES_TEXT, NO_LEAKS_TEXT } from "../../src/progress/queue-model.js";
import { COSMETIC_SLOTS, useCosmeticsStore, useThemeStore } from "../../src/store/index.js";
import { jsonResponse, problemResponse, sessionResponse, type FetchScript, type ResponseFactory } from "../api/fake-fetch.js";
import { renderApp } from "../app/render-app.js";

const PATHS = {
  rating: "GET /api/v1/progress/rating",
  tracks: "GET /api/v1/progress/tracks",
  leaks: "GET /api/v1/progress/leaks",
  heatmap: "GET /api/v1/progress/heatmap",
  streak: "GET /api/v1/progress/streak",
} as const;

const seasoned: FetchScript = {
  "GET /api/v1/me": [sessionResponse()],
  [PATHS.rating]: [jsonResponse(200, fixtureRating)],
  [PATHS.tracks]: [jsonResponse(200, { items: fixtureTracks, next_cursor: null })],
  [PATHS.leaks]: [jsonResponse(200, fixtureLeaks)],
  [PATHS.heatmap]: [jsonResponse(200, fixtureHeatmap)],
  [PATHS.streak]: [jsonResponse(200, fixtureStreak)],
};

const fresh: FetchScript = {
  ...seasoned,
  [PATHS.rating]: [jsonResponse(200, fixtureFreshRating)],
  [PATHS.tracks]: [jsonResponse(200, { items: fixtureFreshTracks, next_cursor: null })],
  [PATHS.leaks]: [jsonResponse(200, fixtureFreshLeaks)],
  [PATHS.heatmap]: [jsonResponse(200, fixtureFreshHeatmap)],
  [PATHS.streak]: [jsonResponse(200, fixtureFreshStreak)],
};

const pending: ResponseFactory = () => new Promise<Response>(() => undefined);

function clearChoices(): void {
  for (const slot of COSMETIC_SLOTS) useCosmeticsStore.getState().equip(slot, null);
}

function card(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

beforeEach(() => {
  useThemeStore.getState().setTheme("light");
  defaultHotkeyStore.getState().setOverlayOpen(false);
  clearChoices();
});

afterEach(clearChoices);

describe("R4.12 home queue card", () => {
  it("R4.12 shows due and new counts, the top three leaks and a Start training link", async () => {
    renderApp("/", seasoned);

    expect(await screen.findByTestId("queue-due")).toHaveTextContent("22 classes due for review.");
    const queue = card("Today's queue");
    expect(within(queue).getByTestId("queue-new")).toHaveTextContent("8 classes not practiced yet.");
    const leaks = within(within(queue).getByRole("list", { name: "Top leaks" })).getAllByRole("listitem");
    expect(leaks).toHaveLength(3);
    expect(leaks[0]).toHaveTextContent("Open or fold");
    expect(leaks[0]).toHaveTextContent("42.0 bb per 1,000 hands");
    expect(within(queue).getByRole("link", { name: "Start training" })).toHaveAttribute("href", "/train");
  });

  it("R4.12 a fresh learner sees nothing due, every class new and no leaks yet", async () => {
    renderApp("/", fresh);

    expect(await screen.findByTestId("queue-due")).toHaveTextContent("Nothing due for review now.");
    const queue = card("Today's queue");
    expect(within(queue).getByTestId("queue-new")).toHaveTextContent("40 classes not practiced yet.");
    expect(within(queue).getByText(NO_LEAKS_TEXT)).toBeInTheDocument();
  });

  it("R4.12 an empty library says so", async () => {
    renderApp("/", { ...fresh, [PATHS.heatmap]: [jsonResponse(200, { rows: [], columns: [], cells: [] })] });
    expect(await screen.findByTestId("queue-empty")).toHaveTextContent(NO_CLASSES_TEXT);
  });

  it("R4.12 a failed read shows an alert and Try again loads the queue", async () => {
    const user = userEvent.setup();
    renderApp("/", { ...seasoned, [PATHS.heatmap]: [problemResponse(500, "internal"), jsonResponse(200, fixtureHeatmap)] });

    const queue = await screen.findByRole("region", { name: "Today's queue" });
    expect(await within(queue).findByRole("alert")).toHaveTextContent("Today's queue could not be loaded.");
    await user.click(within(queue).getByRole("button", { name: "Try again: today's queue" }));
    expect(await within(queue).findByTestId("queue-due")).toHaveTextContent("22 classes due for review.");
  });

  it("R4.12 the cards say they are loading while the reads are on the way", async () => {
    renderApp("/", { "GET /api/v1/me": [sessionResponse()], [PATHS.rating]: [pending], [PATHS.tracks]: [pending], [PATHS.leaks]: [pending], [PATHS.heatmap]: [pending], [PATHS.streak]: [pending] });

    expect(await screen.findByText("Loading today's queue.")).toBeInTheDocument();
    expect(screen.getByText("Loading the streak.")).toBeInTheDocument();
    expect(screen.getByText("Loading the rating.")).toBeInTheDocument();
  });
});

describe("R4.14 home streak and rating cards", () => {
  it("R4.14 the streak tile shows the current streak and names the next milestone from the catalog", async () => {
    renderApp("/", seasoned);

    expect(await screen.findByTestId("streak-current")).toHaveTextContent("9 days");
    expect(screen.getByTestId("streak-next")).toHaveTextContent("Next: 30 days unlocks Thirty-day streak badge.");
  });

  it("R4.12 the rating card shows the rating, names held-back tracks and links to /progress", async () => {
    renderApp("/", seasoned);

    expect(await screen.findByTestId("rating-value")).toHaveTextContent("1612");
    const rating = card("Rating");
    await waitFor(() => expect(within(rating).getByTestId("rating-blocked")).toHaveTextContent("Live limped and straddled pots"));
    expect(within(rating).getByRole("link", { name: "Open progress" })).toHaveAttribute("href", "/progress");
    expect(within(rating).queryByTestId("badge-pill")).toBeNull();
  });

  it("R4.14 an equipped unlocked badge shows as a pill on the rating card", async () => {
    useCosmeticsStore.getState().equip("badge", "badge-streak-7");
    renderApp("/", seasoned);
    expect(await screen.findByTestId("badge-pill")).toHaveTextContent("Seven-day streak badge");
    expect(card("Rating")).toContainElement(screen.getByTestId("badge-pill"));
  });

  it("R4.14 an equipped badge the server has not unlocked is not shown", async () => {
    useCosmeticsStore.getState().equip("badge", "badge-streak-100");
    renderApp("/", seasoned);
    expect(await screen.findByTestId("rating-value")).toHaveTextContent("1612");
    expect(screen.queryByTestId("badge-pill")).toBeNull();
  });

  it("R4.12 a fresh learner is unrated with a zero-day streak", async () => {
    renderApp("/", fresh);

    expect(await screen.findByTestId("rating-value")).toHaveTextContent("Unrated");
    expect(await screen.findByTestId("streak-current")).toHaveTextContent("0 days");
  });

  it("R4.14 failed streak and rating reads each offer Try again", async () => {
    const user = userEvent.setup();
    renderApp("/", {
      ...seasoned,
      [PATHS.streak]: [problemResponse(500, "internal"), jsonResponse(200, fixtureStreak)],
      [PATHS.rating]: [problemResponse(500, "internal"), jsonResponse(200, fixtureRating)],
    });

    await user.click(await screen.findByRole("button", { name: "Try again: the streak" }));
    expect(await screen.findByTestId("streak-current")).toHaveTextContent("9 days");
    await user.click(screen.getByRole("button", { name: "Try again: the rating" }));
    expect(await screen.findByTestId("rating-value")).toHaveTextContent("1612");
  });
});
