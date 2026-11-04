/**
 * The /quiz start screen (S41, R3.16, O-350, O-410, O-411, O-415, O-416): the table select over the
 * catalog, the session defaults' preselection, positions with uncovered seats disabled and named,
 * the spot types, question kinds and difficulty, the Start rule, the address it writes, the
 * catalog-spot start request (sent on Start only, PR #39 security LOW 2) and the fixed no-coverage
 * sentence.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { fixturePredictionPrompt } from "../../src/fixtures/prediction.js";
import { DEFAULT_SESSION_DEFAULTS, useSessionDefaultsStore } from "../../src/store/session-defaults.js";
import { jsonResponse, problemResponse } from "../api/fake-fetch.js";
import { NEXT_PATH, START_PATH, pressStart, renderQuiz } from "./render-quiz.js";
import { APP_SUITE } from "./app-suite-timeout.js";

const FULL = "/quiz?config=cfg_6_online_100&positions=BB&spots=vs_open&kinds=range,hand&difficulty=medium";

afterEach(() => {
  useSessionDefaultsStore.setState({ defaults: DEFAULT_SESSION_DEFAULTS });
});

async function startScreen() {
  return screen.findByRole("combobox", { name: "Table" });
}

describe("R3.16 /quiz start screen", APP_SUITE, () => {
  it("R3.16 offers every served configuration by its label and preselects the first", async () => {
    const view = renderQuiz("/quiz", {});
    const table = await startScreen();
    await waitFor(() => expect(within(table).getAllByRole("option")).toHaveLength(3));
    expect(within(table).getByRole("option", { name: "Online, 6 players, 100bb deep" })).toBeInTheDocument();
    expect(table).toHaveValue("cfg_6_online_100");
    expect(view.sentTo(START_PATH)).toHaveLength(0);
  });

  it("R3.16 preselects the session defaults' first configuration when the scope is a list", async () => {
    useSessionDefaultsStore.setState({ defaults: { ...DEFAULT_SESSION_DEFAULTS, configScope: ["cfg_6_online_200"] } });
    renderQuiz("/quiz", {});
    const table = await startScreen();
    await waitFor(() => expect(table).toHaveValue("cfg_6_online_200"));
  });

  it("R3.16 lists the seats of the table, disabling a seat with no covered pair and naming it", async () => {
    renderQuiz("/quiz", {});
    await startScreen();
    const positions = await screen.findByRole("group", { name: "Positions" });
    await waitFor(() => expect(within(positions).getByRole("button", { name: "BB" })).toBeEnabled());
    expect(within(positions).getAllByRole("button").map((button) => button.textContent)).toEqual(["UTG", "HJ", "CO", "BTN", "SB", "BB"]);
    expect(within(positions).getByRole("button", { name: "UTG" })).toHaveAttribute("aria-disabled", "true");
    expect(within(positions).getByRole("button", { name: "CO" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("No solved spot yet for UTG, HJ, CO.")).toBeInTheDocument();
  });

  it("R3.16 offers the spot types, the question kinds and the difficulty with a line on each level", async () => {
    renderQuiz("/quiz", {});
    await startScreen();
    const spots = screen.getByRole("group", { name: "Spot types" });
    expect(within(spots).getAllByRole("button").map((button) => button.textContent)).toEqual(["Open", "Facing an open", "Facing a 3-bet", "Squeeze", "Facing a 4-bet"]);
    const kinds = screen.getByRole("group", { name: "Question kinds" });
    expect(within(kinds).getAllByRole("button").map((button) => button.textContent)).toEqual(["Range questions", "Hand questions"]);
    const difficulty = screen.getByRole("radiogroup", { name: "Difficulty" });
    expect(within(difficulty).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Easy", "Medium", "Hard"]);
    // One line per level, as a list (S47 critic G8).
    expect(within(screen.getByRole("list", { name: "Difficulty" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Easy: over or under a share, and the highest-EV action.",
      "Medium: the share, and a frequency band.",
      "Hard: which regions mix, and the raise size played most.",
    ]);
  });

  it("R3.16 Start quiz waits for a position, a spot type and a question kind, then writes the choice to the address", async () => {
    const user = userEvent.setup();
    const view = renderQuiz("/quiz", { [NEXT_PATH]: [jsonResponse(200, fixturePredictionPrompt("percent"))] });
    await startScreen();
    const start = screen.getByRole("button", { name: "Start quiz" });
    expect(start).toBeDisabled();
    const positions = screen.getByRole("group", { name: "Positions" });
    await waitFor(() => expect(within(positions).getByRole("button", { name: "BB" })).toBeEnabled());
    await user.click(within(positions).getByRole("button", { name: "BB" }));
    await user.click(within(positions).getByRole("button", { name: "BTN" }));
    expect(start).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Facing an open" }));
    expect(start).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Hand questions" }));
    await user.click(screen.getByRole("radio", { name: "Hard" }));
    expect(start).toBeEnabled();
    await user.click(start);
    await waitFor(() => expect(view.router.state.location.pathname).toBe("/quiz"));
    expect(view.router.state.location.search).toEqual({
      config: "cfg_6_online_100",
      positions: "BTN,BB",
      spots: "vs_open",
      kinds: "hand",
      difficulty: "hard",
    });
    await screen.findByRole("heading", { name: fixturePredictionPrompt("percent").question });
  });

  it("R3.16 an address with a full valid choice fills the start screen; Start quiz posts a catalog-spot prediction session with the quiz options", async () => {
    const view = renderQuiz(`${FULL}&seed=00000000deadbeef`, { [NEXT_PATH]: [jsonResponse(200, fixturePredictionPrompt("percent"))] });
    await pressStart();
    await screen.findByRole("heading", { name: fixturePredictionPrompt("percent").question });
    const [start] = view.sentTo(START_PATH);
    expect(start?.body).toEqual({
      mode: "prediction",
      catalog_spot: { config_id: "cfg_6_online_100", hero_positions: ["BB"], spot_types: ["vs_open"] },
      quiz: { difficulty: "medium", question_kinds: ["range", "hand"] },
      seed: "00000000deadbeef",
    });
    expect(start?.idempotencyKey).not.toBeNull();
    expect(start?.csrf).not.toBeNull();
    expect(view.sentTo(START_PATH)).toHaveLength(1);
  });

  it("R3.16 a no-coverage answer shows the fixed sentence, never the server's detail", async () => {
    renderQuiz(FULL, { [START_PATH]: [problemResponse(422, "no-coverage")] });
    await pressStart();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The library has no solved spot for these choices yet. They were queued for the builder.");
    expect(alert).not.toHaveTextContent("server detail text");
  });

  it("R3.16 a partial address opens the start screen with its valid choices filled in", async () => {
    const view = renderQuiz("/quiz?config=cfg_6_online_200&spots=rfi&difficulty=hard", {});
    const table = await startScreen();
    await waitFor(() => expect(table).toHaveValue("cfg_6_online_200"));
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("radio", { name: "Hard" })).toHaveAttribute("aria-checked", "true");
    expect(view.sentTo(START_PATH)).toHaveLength(0);
  });

  it("R3.16 a failed configuration read shows fixed text", async () => {
    renderQuiz("/quiz", { "GET /api/v1/configs": [problemResponse(503, "unavailable")] });
    expect(await screen.findByRole("alert")).toHaveTextContent("The solver service did not answer");
    expect(screen.queryByText("server detail text")).not.toBeInTheDocument();
  });
});
