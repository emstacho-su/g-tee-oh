/**
 * The /train recap and what ending a session does (S32, R4.10, R4.12, O-8, O-252, O-279, O-325,
 * O-326): decisions, rated decisions, mean score as a percent, EV loss in bb, the per-track rating
 * table with "new" for a track rated for the first time, the tier with the tracks that hold it,
 * the unlocked cosmetics by name, the note when nothing was rated, Train again, and every progress
 * read invalidated once the recap arrives.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import {
  FIXTURE_AUTOMATED_SESSION_ID,
  fixtureAutomatedSession,
  fixtureBlockPrompt,
  fixtureRatedBlock,
  fixtureTrainingRecap,
  fixtureUnratedRecap,
} from "../../src/fixtures/automated.js";
import { fixtureRating } from "../../src/fixtures/progress.js";
import { progressKeys } from "../../src/progress/queries.js";
import { changeText } from "../../src/routes/train/TrainingRecap.js";
import type { SessionRecap } from "../../src/trainer/session-types.js";
import { jsonResponse } from "../api/fake-fetch.js";
import { AUTOMATED_PATHS, START_PATH, renderTrain, resetDefaults, type TrainView } from "./render-train.js";

function endScript(recap: SessionRecap) {
  return {
    [START_PATH]: [jsonResponse(201, fixtureAutomatedSession())],
    [AUTOMATED_PATHS.next]: [jsonResponse(200, fixtureBlockPrompt(fixtureRatedBlock, 0, FIXTURE_AUTOMATED_SESSION_ID, 1))],
    [AUTOMATED_PATHS.end]: [jsonResponse(200, recap)],
  };
}

async function startAndEnd(view: TrainView): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole("button", { name: "Start training" }));
  await screen.findByRole("group", { name: "Actions" });
  await userEvent.keyboard("e");
  const dialog = await screen.findByRole("dialog", { name: "End this session?" });
  await userEvent.click(within(dialog).getByRole("button", { name: "End session" }));
  expect(view.sentTo(AUTOMATED_PATHS.end)).toHaveLength(1);
  return screen.findByTestId("training-recap");
}

afterEach(() => {
  resetDefaults();
});

describe("R4.10 training recap", () => {
  it("R4.10 the recap shows decisions, rated decisions, mean score as a percent and EV loss in bb", async () => {
    const view = await renderTrain("automated", endScript(fixtureTrainingRecap));
    const recap = await startAndEnd(view);
    const summary = within(recap).getByTestId("recap-summary");
    expect(summary).toHaveTextContent("Decisions5");
    expect(summary).toHaveTextContent("Rated decisions3");
    expect(summary).toHaveTextContent("Mean score81%");
    expect(summary).toHaveTextContent("EV loss0.42bb");
    expect(within(recap).queryByTestId("nothing-rated")).not.toBeInTheDocument();
  });

  it("R4.10 the rating table gives each track before and after with RD, new for a first rating, and the change", async () => {
    const view = await renderTrain("automated", endScript(fixtureTrainingRecap));
    const recap = await startAndEnd(view);
    const table = within(recap).getByRole("table", { name: "Rating by track" });
    await waitFor(() => expect(within(table).getByRole("rowheader", { name: "Opens" })).toBeInTheDocument());
    const [, opens, facing] = within(table).getAllByRole("row");
    expect(opens).toHaveTextContent("1584 ± 96");
    expect(opens).toHaveTextContent("1602 ± 92");
    expect(opens).toHaveTextContent("+18");
    expect(facing).toHaveTextContent("Facing an open in position");
    expect(within(facing as HTMLElement).getAllByText("new")).toHaveLength(2);
    expect(facing).toHaveTextContent("1532 ± 290");
  });

  it("R4.10 the tier after the session names the tracks holding it, and unlocks are named from the catalog (O-252, O-279)", async () => {
    const view = await renderTrain("automated", endScript({ ...fixtureTrainingRecap, unlocks: ["badge-tier-II", "unknown-key"] }));
    const recap = await startAndEnd(view);
    const tier = within(recap).getByTestId("recap-tier");
    expect(tier).toHaveTextContent("Tier II");
    await waitFor(() => expect(tier).toHaveTextContent("reaches Tier III; it waits until these tracks settle: Facing an open in position."));
    const unlocks = within(recap).getByRole("list", { name: "Unlocked" });
    expect(within(unlocks).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Tier II badge", "unknown-key"]);
    expect(within(recap).getByRole("link", { name: "See progress" })).toHaveAttribute("href", "/progress");
  });

  it("R4.10 when nothing was rated the recap says so and why, with no rating table, tier or unlocks", async () => {
    const view = await renderTrain("automated", endScript(fixtureUnratedRecap));
    const recap = await startAndEnd(view);
    expect(within(recap).getByTestId("nothing-rated")).toHaveTextContent("worked example");
    expect(within(recap).getByTestId("nothing-rated")).toHaveTextContent("holdout retest");
    expect(within(recap).getByTestId("recap-summary")).toHaveTextContent("Mean scoreNone rated");
    expect(within(recap).queryByRole("table")).not.toBeInTheDocument();
    expect(within(recap).queryByTestId("recap-tier")).not.toBeInTheDocument();
    expect(within(recap).queryByTestId("recap-unlocks")).not.toBeInTheDocument();
  });

  it("R4.10 Train again goes back to the start panel", async () => {
    const view = await renderTrain("automated", endScript(fixtureTrainingRecap));
    const recap = await startAndEnd(view);
    await userEvent.click(within(recap).getByRole("button", { name: "Train again" }));
    expect(await screen.findByRole("button", { name: "Start training" })).toBeEnabled();
    expect(screen.queryByTestId("training-recap")).not.toBeInTheDocument();
  });

  it("R4.10 the change reads +n, -n or 0 against the rating before", () => {
    const after = { mu: 1500.4, rd: 80 };
    expect(changeText({ track_key: "opens", before: { mu: 1504, rd: 82 }, after })).toBe("-4");
    expect(changeText({ track_key: "opens", before: { mu: 1500, rd: 82 }, after })).toBe("0");
  });
});

describe("R4.12 progress refresh on end (O-326)", () => {
  it("R4.12 ending a session invalidates every progress read, so the home and /progress cards refetch", async () => {
    const view = await renderTrain("automated", endScript(fixtureTrainingRecap));
    view.queryClient.setQueryData(progressKeys.rating, fixtureRating);
    expect(view.queryClient.getQueryState(progressKeys.rating)?.isInvalidated).toBe(false);
    await startAndEnd(view);
    await waitFor(() => expect(view.queryClient.getQueryState(progressKeys.rating)?.isInvalidated).toBe(true));
  });

  it("R4.12 nothing is invalidated before the recap arrives", async () => {
    const view = await renderTrain("automated", { ...endScript(fixtureTrainingRecap), [AUTOMATED_PATHS.end]: [() => new Promise<Response>(() => undefined)] });
    view.queryClient.setQueryData(progressKeys.rating, fixtureRating);
    await userEvent.click(screen.getByRole("button", { name: "Start training" }));
    await screen.findByRole("group", { name: "Actions" });
    await userEvent.keyboard("e");
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "End session" }));
    expect(await screen.findByText("Ending the session")).toBeInTheDocument();
    expect(view.queryClient.getQueryState(progressKeys.rating)?.isInvalidated).toBe(false);
  });
});
