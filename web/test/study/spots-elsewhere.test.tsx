/**
 * Tests for the saved spots outside Study (S45, R3.27): the library's coverage heading carries a
 * star for the selected configuration and pair, the library filters offer "Your spots" as links
 * into Study, and the Home card lists the starred and recent spots as links, with one-line empty
 * states. All read the one per-browser store.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FIXTURE_ONLINE_STAKE_ID, FIXTURE_STUDY_PAIR } from "../../src/fixtures/study.js";
import { SPOT_TEXT } from "../../src/routes/study/SpotShortcuts.js";
import { useStudySpotsStore } from "../../src/store/study-spots.js";
import { jsonResponse, sessionResponse, type FetchScript } from "../api/fake-fetch.js";
import { renderApp } from "../app/render-app.js";
import { libraryPath, renderLibrary } from "../library/render-library.js";

const SPOT = { format: "online", table_size: 6, stake: FIXTURE_ONLINE_STAKE_ID, depth: 10000, pair: FIXTURE_STUDY_PAIR } as const;
const HOME_LABEL = "Online, 6 players, 100bb, BTN against BB";

const HOME_SCRIPT: FetchScript = {
  "GET /api/v1/me": [sessionResponse()],
  "GET /api/v1/progress/rating": [jsonResponse(500, {})],
  "GET /api/v1/progress/tracks": [jsonResponse(500, {})],
  "GET /api/v1/progress/leaks": [jsonResponse(500, {})],
  "GET /api/v1/progress/heatmap": [jsonResponse(500, {})],
  "GET /api/v1/progress/streak": [jsonResponse(500, {})],
};

describe("R3.27 spots in the library", () => {
  it("R3.27 the coverage heading's star toggles the selected spot", async () => {
    const user = userEvent.setup();
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_STUDY_PAIR));
    const star = await screen.findByRole("button", { name: SPOT_TEXT.star });
    expect(star).toHaveAttribute("aria-pressed", "false");
    await user.click(star);
    await waitFor(() => expect(useStudySpotsStore.getState().starred).toEqual([SPOT]));
  });

  it("R3.27 the library filters offer the starred spots as links into Study", async () => {
    useStudySpotsStore.getState().toggleStar(SPOT);
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID));
    const yours = await screen.findByRole("list", { name: SPOT_TEXT.yourSpots });
    const link = within(yours).getByRole("link", { name: /BTN against BB/ });
    expect(link.getAttribute("href")).toContain("/study?");
    expect(link.getAttribute("href")).toContain(`pair=${FIXTURE_STUDY_PAIR}`);
  });
});

describe("R3.27 spots on Home", () => {
  it("R3.27 the Your spots card lists the starred and recent spots as links into Study", async () => {
    useStudySpotsStore.getState().toggleStar(SPOT);
    useStudySpotsStore.getState().recordConfirmed({ ...SPOT, line: "r250" });
    renderApp("/", HOME_SCRIPT);
    const card = await screen.findByRole("region", { name: SPOT_TEXT.cardTitle });
    expect(within(within(card).getByRole("list", { name: SPOT_TEXT.yourSpots })).getByRole("link", { name: HOME_LABEL })).toBeInTheDocument();
    expect(
      within(within(card).getByRole("list", { name: SPOT_TEXT.recentSpots })).getByRole("link", { name: `${HOME_LABEL}, single-raised pot` }),
    ).toBeInTheDocument();
  });

  it("R3.27 an empty store shows the one-line empty states", async () => {
    renderApp("/", HOME_SCRIPT);
    const card = await screen.findByRole("region", { name: SPOT_TEXT.cardTitle });
    expect(card).toHaveTextContent(SPOT_TEXT.noStarred);
    expect(card).toHaveTextContent(SPOT_TEXT.noRecent);
  });
});
