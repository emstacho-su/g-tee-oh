/**
 * /train through the whole app (S32, R4.10, O-328): the real route tree over a memory history and
 * the fake fetch (test/app/render-app.tsx). /train is automated training; /train?mode=holdout is
 * the holdout retest; any other mode value is dropped by the search validator. The holdout card's
 * button opens /train?mode=holdout, and a 401 in a session sends the user to /login.
 */
import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fixtureHoldoutSession } from "../../src/fixtures/automated.js";
import { HoldoutRetestButton } from "../../src/routes/train/HoldoutRetestButton.js";
import { trainModeOf, validateTrainSearch } from "../../src/routes/train/train-search.js";
import { jsonResponse, problemResponse } from "../api/fake-fetch.js";
import { renderApp, SIGNED_IN } from "../app/render-app.js";
import { renderInRouter } from "../trainer-screen/screen-router.js";
import { HOLDOUT_PATHS, SIDE_READS, START_PATH } from "./render-train.js";

describe("R4.10 /train route", () => {
  it("R4.10 /train shows automated training inside the shell, no longer a placeholder", async () => {
    renderApp("/train", { ...SIGNED_IN, ...SIDE_READS });
    const heading = await screen.findByRole("heading", { level: 1, name: "Automated training" });
    expect(screen.getByTestId("shell").contains(heading)).toBe(true);
    expect(screen.getByRole("button", { name: "Start training" })).toBeInTheDocument();
    expect(screen.queryByText(/Built in/)).not.toBeInTheDocument();
  });

  it("R4.10 /train?mode=holdout opens the holdout retest (O-328)", async () => {
    renderApp("/train?mode=holdout", { ...SIGNED_IN, ...SIDE_READS });
    expect(await screen.findByRole("heading", { level: 1, name: "Holdout retest" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start the retest" })).toBeInTheDocument();
  });

  it("R4.10 any other mode is automated training", async () => {
    renderApp("/train?mode=HOLDOUT&seed=0123456789abcdef", { ...SIGNED_IN, ...SIDE_READS });
    expect(await screen.findByRole("heading", { level: 1, name: "Automated training" })).toBeInTheDocument();
  });

  it("R4.10 a 401 in a session sends the user to /login with /train as the redirect", async () => {
    const { router } = renderApp("/train?mode=holdout", {
      ...SIGNED_IN,
      ...SIDE_READS,
      [START_PATH]: [jsonResponse(201, fixtureHoldoutSession)],
      [HOLDOUT_PATHS.next]: [problemResponse(401, "unauthenticated")],
    });
    await userEvent.click(await screen.findByRole("button", { name: "Start the retest" }));
    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ redirect: "/train?mode=holdout" });
  });

  it("R4.10 the search validator keeps only mode=holdout", () => {
    expect(validateTrainSearch({ mode: "holdout", seed: "0123456789abcdef" })).toEqual({ mode: "holdout" });
    expect(validateTrainSearch({ mode: "automated" })).toEqual({});
    expect(validateTrainSearch({ mode: ["holdout"] })).toEqual({});
    expect(trainModeOf({ mode: "holdout" })).toBe("holdout");
    expect(trainModeOf({})).toBe("automated");
  });
});

describe("R4.12 holdout retest button (O-328)", () => {
  it("R4.12 the button links to /train?mode=holdout and says start, or resume when a round is open", async () => {
    const { rerender } = await renderInRouter(<HoldoutRetestButton />);
    const start = screen.getByRole("link", { name: "Start this month's retest" });
    expect(start).toHaveAttribute("href", "/train?mode=holdout");
    rerender(<HoldoutRetestButton resume />);
    expect(within(document.body).getByRole("link", { name: "Resume this month's retest" })).toBeInTheDocument();
  });
});
