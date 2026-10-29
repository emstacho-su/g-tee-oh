/**
 * Tests for action filters on the study screen (S45, R3.12, O-468, O-469): a row of the Range by
 * action table toggles its index into the address with replace, chips with an x and a Clear
 * button sit above the matrix, the set survives a line change, a second row clicked while one is
 * selected opens Compare to Best on that row, indexes naming no action are ignored and never
 * rewritten, the hand row marks the filtered actions, combos print when served and the action
 * legend under the matrix is hidden because the table is the legend (design rule 3).
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_CHILD_LINE, FIXTURE_ONLINE_STAKE_ID, FIXTURE_STUDY_PAIR, fixtureRootNode } from "../../src/fixtures/study.js";
import { nodeJson, renderStudy } from "./render-study.js";

const BASE = `/study?format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000&pair=${FIXTURE_STUDY_PAIR}`;
const RANGE_TABLE = "Range by action at this node";
/** Multi-step flows through the whole app; under a full parallel run they need more than the 5 s default. */
const FLOW_TIMEOUT_MS = 15_000;

let spies: { mockRestore: () => void }[] = [];

beforeEach(() => {
  spies = [
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null),
    vi.spyOn(console, "info").mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  spies.forEach((spy) => spy.mockRestore());
});

async function rangeTable(): Promise<HTMLElement> {
  return screen.findByRole("table", { name: new RegExp(RANGE_TABLE) });
}

describe("R3.12 action rows filter the matrix", () => {
  it("R3.12 a row click writes its index to the address with replace; the chip and Clear appear; a second click on it removes it", async () => {
    const user = userEvent.setup();
    const { router } = renderStudy(BASE);
    const table = await rangeTable();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    const depth = router.history.length;
    await user.click(within(table).getByRole("button", { name: /Raise to 2.5bb/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ filters: "2" }));
    expect(router.history.length).toBe(depth);
    const chips = screen.getByRole("list", { name: "Active filters" });
    expect(within(chips).getByRole("button", { name: "Remove filter Raise to 2.5bb" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: /Raise to 2.5bb/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(table).getByRole("button", { name: /Raise to 2.5bb/ }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("filters"));
  }, FLOW_TIMEOUT_MS);

  it("R3.12 the chip's x removes one filter and Clear empties the set", async () => {
    const user = userEvent.setup();
    const { router } = renderStudy(`${BASE}&filters=0,2`);
    await rangeTable();
    await user.click(screen.getByRole("button", { name: "Remove filter Fold" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ filters: "2" }));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("filters"));
    expect(screen.queryByRole("list", { name: "Active filters" })).not.toBeInTheDocument();
  });

  it("R3.12 a line change drops the filters and the lens: an index names another action at the next node (code review)", async () => {
    const user = userEvent.setup();
    const { router } = renderStudy(`${BASE}&filters=2&mode=compare&lens=2`);
    await rangeTable();
    const actions = await screen.findByRole("region", { name: /'s actions$/ });
    await user.click(within(actions).getByRole("button", { name: /^Raise to 2.5bb/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ line: FIXTURE_CHILD_LINE, mode: "compare" }));
    expect(router.state.location.search).not.toHaveProperty("filters");
    expect(router.state.location.search).not.toHaveProperty("lens");
  });

  it("R3.12 a mode or hand change keeps the filters and the lens", async () => {
    const user = userEvent.setup();
    const { router } = renderStudy(`${BASE}&filters=2&mode=compare&lens=2`);
    await rangeTable();
    await user.click(screen.getByRole("radio", { name: "Strategy with EV" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ mode: "strategy_ev", filters: "2", lens: "2" }));
  });

  it("R3.12 a second row clicked while exactly one is selected opens Compare to Best on that row with both kept (O-468)", async () => {
    const user = userEvent.setup();
    const { router } = renderStudy(`${BASE}&filters=2`);
    const table = await rangeTable();
    await user.click(within(table).getByRole("button", { name: /^Call/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ mode: "compare", lens: "1", filters: "1,2" }));
    expect(await screen.findByRole("img", { name: /compare to best mode/ })).toBeInTheDocument();
  });

  it("R3.12 an index naming no action is ignored and not rewritten; the matrix is labelled with the filtered actions", async () => {
    const { router } = renderStudy(`${BASE}&filters=2,9`);
    await rangeTable();
    const chips = screen.getByRole("list", { name: "Active filters" });
    expect(within(chips).getAllByRole("listitem")).toHaveLength(1);
    expect(router.state.location.search).toMatchObject({ filters: "2,9" });
    expect(screen.getByRole("img", { name: /^Range matrix, frequency mode, 169 hands, filtered to Raise to 2.5bb$/ })).toBeInTheDocument();
  });

  it("R3.12 the hand row marks the filtered actions", async () => {
    renderStudy(`${BASE}&hand=AKs&filters=2`);
    const hand = await screen.findByRole("table", { name: "AKs at this node: strategy and EV" });
    expect(within(hand).getByRole("row", { name: /Raise to 2.5bb/ })).toHaveTextContent("Filtered");
    expect(within(hand).getByRole("row", { name: /Fold/ })).not.toHaveTextContent("Filtered");
  });

  it("R3.12 on Study the action legend under the matrix is hidden: the table is the legend", async () => {
    renderStudy(BASE);
    await rangeTable();
    expect(screen.queryByRole("list", { name: "Action legend" })).not.toBeInTheDocument();
  });
});

describe("R3.12 combos beside percentages (O-469)", () => {
  const served = {
    ...fixtureRootNode,
    range_by_action: fixtureRootNode.range_by_action.map((entry) => ({ ...entry, combos: entry.share * 1000 })),
    range_combos: { combos: 1326, reach_weighted_combos: 1000 },
  };

  it("R3.12 prints the served combos beside each percent and the range total under the caption", async () => {
    renderStudy(BASE, (request) => (request.path === "/api/v1/study/node" ? nodeJson(served) : undefined));
    const table = await rangeTable();
    expect(within(table).getByRole("row", { name: /Raise to 2.5bb/ })).toHaveTextContent("38.0%, 380 combos");
    expect(table).toHaveTextContent("1,000 of 1,326 combos reach this node");
  });

  it("R3.12 prints percents alone when the api serves no combos", async () => {
    renderStudy(BASE);
    const table = await rangeTable();
    expect(within(table).getByRole("row", { name: /Raise to 2.5bb/ })).toHaveTextContent("38.0%");
    expect(table).not.toHaveTextContent("combos");
  });
});
