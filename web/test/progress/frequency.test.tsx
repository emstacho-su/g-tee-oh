/**
 * Your frequencies against the solver's (S41, R4.12, O-347, O-353, O-367, O-417, O-418): the pure
 * model (spot names from the response fields and the configuration list, action family words,
 * the spot key of solution and node, the sample line) and the /progress card over a fake fetch (the
 * spot select, paired bars with numbers in words, hand rows in the api's order, the screen-reader
 * table, the below-minimum line, the empty state and a failed read with Try again).
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FIELD_CLASS } from "../../src/components/ui/index.js";
import { fixtureFreshFrequencies, fixtureFrequencies } from "../../src/fixtures/frequencies.js";
import {
  fixtureHeatmap,
  fixtureHoldout,
  fixtureLeaks,
  fixtureRating,
  fixtureStreak,
  fixtureTracks,
} from "../../src/fixtures/progress.js";
import { fixtureConfigs } from "../../src/fixtures/study.js";
import { familyWords, sampleText, spotKey, spotOptions } from "../../src/progress/frequency-model.js";
import * as frequencyModel from "../../src/progress/frequency-model.js";
import { frequencyQuery } from "../../src/progress/frequency-query.js";
import { createAppApi } from "../../src/api/index.js";
import { jsonResponse, problemResponse, type FetchScript } from "../api/fake-fetch.js";
import { SIGNED_IN, TEST_ORIGIN, renderApp } from "../app/render-app.js";
import { APP_SUITE } from "../quiz/app-suite-timeout.js";

const FREQUENCIES = "GET /api/v1/progress/frequencies";
const REBUILT_SOLUTION_ID = "00000000-0000-4000-8000-0000000f0f0f";
const [ABOVE, BELOW] = fixtureFrequencies.spots;
if (ABOVE === undefined || BELOW === undefined) throw new Error("fixture spots missing");

function progress(frequencies: FetchScript[string]): FetchScript {
  return {
    ...SIGNED_IN,
    "GET /api/v1/progress/rating": [jsonResponse(200, fixtureRating)],
    "GET /api/v1/progress/tracks": [jsonResponse(200, { items: fixtureTracks, next_cursor: null })],
    "GET /api/v1/progress/leaks": [jsonResponse(200, fixtureLeaks)],
    "GET /api/v1/progress/heatmap": [jsonResponse(200, fixtureHeatmap)],
    "GET /api/v1/progress/holdout": [jsonResponse(200, fixtureHoldout)],
    "GET /api/v1/progress/streak": [jsonResponse(200, fixtureStreak)],
    "GET /api/v1/configs": [jsonResponse(200, { items: fixtureConfigs, next_cursor: null })],
    [FREQUENCIES]: frequencies ?? [],
  };
}

/** The card once its read has settled: the loading card is a different element, so wait it out. */
async function loadedCard(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByTestId("frequency-card")).not.toHaveTextContent("Loading your frequencies"));
  return screen.getByTestId("frequency-card");
}

describe("R4.12 the frequency model", () => {
  it("R4.12 the fixture holds one spot above both minimums and one below the spot minimum", () => {
    expect(fixtureFrequencies.min_spot_decisions).toBe(30);
    expect(ABOVE.decisions).toBeGreaterThanOrEqual(30);
    expect(ABOVE.pooled).not.toBeNull();
    expect(ABOVE.hands.every((hand) => hand.decisions >= fixtureFrequencies.min_hand_decisions)).toBe(true);
    expect(BELOW.decisions).toBeLessThan(30);
    expect(BELOW.pooled).toBeNull();
    expect(fixtureFreshFrequencies.spots).toEqual([]);
  });

  it("R4.12 names action families in words, never by key", () => {
    expect(familyWords("rfi")).toBe("open or fold");
    expect(familyWords("facing-open")).toBe("facing an open");
    expect(familyWords("facing-3bet")).toBe("facing a 3-bet");
    expect(familyWords("facing-4bet")).toBe("facing a 4-bet");
    expect(familyWords("squeeze")).toBe("squeeze");
    expect(familyWords(null)).toBe("preflop spot");
    expect(familyWords("something-new")).toBe("preflop spot");
  });

  it("R4.12 names each spot from the response fields, with the configuration's label when the list is loaded", () => {
    expect(spotOptions(fixtureFrequencies.spots, undefined).map((option) => option.label)).toEqual([
      "Facing an open as big blind (big blind versus button), a configuration the catalog does not list",
      "Open or fold as button (big blind versus button), a configuration the catalog does not list",
    ]);
    expect(spotOptions(fixtureFrequencies.spots, fixtureConfigs)[0]?.label).toBe("Facing an open as big blind (big blind versus button), Online, 6 players, 100bb deep");
    expect(spotOptions(fixtureFrequencies.spots, undefined).map((option) => option.value)).toEqual([spotKey(ABOVE), spotKey(BELOW)]);
  });

  it("R4.12 numbers two spots that would share a name", () => {
    const twin = { ...ABOVE, node_key: `${ABOVE.node_key}.c` };
    expect(spotOptions([ABOVE, twin], undefined).map((option) => option.label)).toEqual([
      "Facing an open as big blind (big blind versus button), a configuration the catalog does not list",
      "Facing an open as big blind (big blind versus button), a configuration the catalog does not list (2)",
    ]);
  });

  it("R4.12 a spot is keyed by its solution and node: a rebuilt node with the same node_key is its own option (PR #39 review finding 6)", () => {
    const rebuilt = { ...ABOVE, solution_id: REBUILT_SOLUTION_ID };
    expect(spotKey(rebuilt)).not.toBe(spotKey(ABOVE));
    expect(spotKey(rebuilt)).toContain(REBUILT_SOLUTION_ID);
    expect(spotKey(rebuilt)).toContain(ABOVE.node_key);
    const values = spotOptions([ABOVE, rebuilt], undefined).map((option) => option.value);
    expect(new Set(values).size).toBe(2);
  });

  it("R4.12 the fixture spots carry distinct solution ids", () => {
    expect(fixtureFrequencies.spots.map((spot) => spot.solution_id)).toEqual([ABOVE.solution_id, BELOW.solution_id]);
    expect(ABOVE.solution_id).not.toBe(BELOW.solution_id);
  });

  it("R4.12 the sample line; the unused gap and pass-through percent helpers are gone (PR #39 review finding 10)", () => {
    expect(sampleText(12, 30)).toBe("12 of 30 decisions at this spot");
    expect(Object.keys(frequencyModel)).not.toContain("largestGap");
    expect(Object.keys(frequencyModel)).not.toContain("percentText");
  });

  it("R4.12 the query reads GET /progress/frequencies under the progress root", async () => {
    const api = createAppApi({ baseUrl: TEST_ORIGIN, fetch: () => Promise.resolve(new Response(JSON.stringify(fixtureFrequencies), { status: 200, headers: { "content-type": "application/json" } })) });
    const options = frequencyQuery(api);
    expect(options.queryKey).toEqual(["progress", "frequencies"]);
    const read = options.queryFn as unknown as () => Promise<unknown>;
    await expect(read()).resolves.toEqual(fixtureFrequencies);
  });
});

describe("R4.12 the frequency card on /progress", APP_SUITE, () => {
  it("R4.12 shows the card with a spot select and paired bars with numbers next to each bar", async () => {
    renderApp("/progress", progress([jsonResponse(200, fixtureFrequencies)]));
    const card = await loadedCard();
    expect(within(card).getByRole("heading", { name: "Your frequencies against the solver's" })).toBeInTheDocument();
    const select = await within(card).findByRole("combobox", { name: "Spot" });
    for (const name of FIELD_CLASS.split(" ")) expect(select).toHaveClass(name);
    await waitFor(() => expect(within(select).getAllByRole("option")[0]).toHaveTextContent("Online, 6 players"));
    const bars = within(card).getByTestId("frequency-bars");
    expect(bars).toHaveAttribute("aria-hidden", "true");
    expect(within(bars).getAllByTestId("frequency-action")).toHaveLength(ABOVE.actions.length);
    expect(within(bars).getAllByTestId("frequency-action")[0]).toHaveTextContent("Fold");
    expect(within(bars).getAllByTestId("frequency-action")[0]).toHaveTextContent("You 40%");
    expect(within(bars).getAllByTestId("frequency-action")[0]).toHaveTextContent("Solver 35%");
  });

  it("R4.12 lists the hand rows in the api's order, the largest gap first", async () => {
    renderApp("/progress", progress([jsonResponse(200, fixtureFrequencies)]));
    const card = await loadedCard();
    const rows = await within(card).findAllByTestId("frequency-hand-row");
    expect(rows.map((row) => within(row).getByTestId("frequency-hand").textContent)).toEqual(ABOVE.hands.map((hand) => hand.hand_class));
    expect(rows[0]).toHaveTextContent(`${ABOVE.hands[0]?.decisions} decisions`);
  });

  it("R4.12 a screen-reader table carries the same numbers", async () => {
    renderApp("/progress", progress([jsonResponse(200, fixtureFrequencies)]));
    const card = await loadedCard();
    const table = await within(card).findByRole("table");
    expect(table.closest(".sr-only") ?? table).toHaveClass("sr-only");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Hands",
      "Decisions",
      ...ABOVE.actions.map((action) => `${action.label}: you, solver`),
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1 + ABOVE.hands.length);
    expect(rows[0]).toHaveTextContent("All hands");
    expect(rows[0]).toHaveTextContent("40%, 35%");
  });

  it("R4.12 a spot below the minimum shows its count and no numbers", async () => {
    const user = userEvent.setup();
    renderApp("/progress", progress([jsonResponse(200, fixtureFrequencies)]));
    const card = await loadedCard();
    await user.selectOptions(await within(card).findByRole("combobox", { name: "Spot" }), spotKey(BELOW));
    expect(within(card).getByText(`${BELOW.decisions} of 30 decisions at this spot`)).toBeInTheDocument();
    expect(within(card).queryByTestId("frequency-bars")).not.toBeInTheDocument();
    expect(within(card).queryByRole("table")).not.toBeInTheDocument();
    expect(within(card).queryByText(/%/)).not.toBeInTheDocument();
  });

  it("R4.12 two spots with the same node_key and different solutions are told apart by the select (PR #39 review finding 6)", async () => {
    const user = userEvent.setup();
    const rebuilt = { ...BELOW, node_key: ABOVE.node_key, solution_id: REBUILT_SOLUTION_ID };
    renderApp("/progress", progress([jsonResponse(200, { ...fixtureFrequencies, spots: [ABOVE, rebuilt] })]));
    const card = await loadedCard();
    const select = await within(card).findByRole("combobox", { name: "Spot" });
    expect(within(select).getAllByRole("option")).toHaveLength(2);
    expect(within(card).getByTestId("frequency-bars")).toBeInTheDocument();
    await user.selectOptions(select, spotKey(rebuilt));
    expect(within(card).getByText(`${rebuilt.decisions} of 30 decisions at this spot`)).toBeInTheDocument();
    expect(within(card).queryByTestId("frequency-bars")).not.toBeInTheDocument();
    await user.selectOptions(select, spotKey(ABOVE));
    expect(within(card).getByTestId("frequency-bars")).toBeInTheDocument();
  });

  it("R4.12 with no spots the card says how to fill it", async () => {
    renderApp("/progress", progress([jsonResponse(200, fixtureFreshFrequencies)]));
    const card = await loadedCard();
    expect(await within(card).findByText("Play 30 preflop decisions at one spot to compare your frequencies with the solver's.")).toBeInTheDocument();
    expect(within(card).queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("R4.12 a failed read shows its own error with Try again, never the server's detail", async () => {
    const { fake } = renderApp("/progress", progress([problemResponse(503, "unavailable"), jsonResponse(200, fixtureFrequencies)]));
    const card = await loadedCard();
    expect(await within(card).findByRole("alert")).toHaveTextContent("Could not load your frequencies.");
    expect(card).not.toHaveTextContent("server detail text");
    await userEvent.click(within(card).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("frequency-bars")).toBeInTheDocument();
    expect(fake.keys().filter((key) => key === FREQUENCIES)).toHaveLength(2);
  });
});
