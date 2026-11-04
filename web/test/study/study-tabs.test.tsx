/**
 * Tests for the right column as tabs on the study screen (S45 follow-up, R3.26, item 10): a WAI-ARIA
 * tablist with Overview, Hands and Compare; Overview by default with the range table and the
 * advantage card; a tab's body and its reads mount only while it is open; the open tab is in the
 * address with replace and remembered per browser; a tab with no data at the node is absent; the
 * street-specific tab carries its street; Compare lists the served loss of every action for the
 * hand and opens the lens on the matrix.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_ONLINE_STAKE_ID, FIXTURE_STUDY_PAIR, fixtureRootNode } from "../../src/fixtures/study.js";
import { STUDY_VIEW_STORAGE_KEY } from "../../src/store/preference-keys.js";
import { nodeJson, renderStudy } from "./render-study.js";

const BASE = `/study?format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000&pair=${FIXTURE_STUDY_PAIR}`;

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

function insightHands(requests: { path: string; query: Record<string, string> }[]): (string | undefined)[] {
  return requests.filter((request) => request.path === "/api/v1/study/insights").map((request) => request.query["hand"]);
}

describe("R3.26 the right column as tabs", () => {
  it("R3.26 a tablist with Overview open by default, the range table and the advantage card inside it", async () => {
    renderStudy(BASE);
    const tablist = await screen.findByRole("tablist", { name: "Study panels" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Overview", "HandsPreflop", "Compare"]);
    expect(within(tablist).getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel", { name: "Overview" });
    expect(within(panel).getByRole("table", { name: /Range by action at this node/ })).toBeInTheDocument();
    expect(await within(panel).findByRole("region", { name: "Range and nut advantage" })).toBeInTheDocument();
  });

  it("R3.26 the Hands tab's reads mount only while it is open", async () => {
    const user = userEvent.setup();
    const { requests } = renderStudy(`${BASE}&hand=AKs`);
    await screen.findByRole("region", { name: "Range and nut advantage" });
    expect(screen.queryByTestId("threshold-card")).not.toBeInTheDocument();
    expect(insightHands(requests)).toEqual(["AA"]);
    await user.click(screen.getByRole("tab", { name: /^Hands/ }));
    expect(await screen.findByTestId("threshold-card")).toHaveTextContent("Your hand: AKs");
    expect(insightHands(requests)).toEqual(["AA", "AKs"]);
  });

  it("R3.26 choosing a tab writes view to the address with replace and remembers it for this browser", async () => {
    const user = userEvent.setup();
    const { router } = renderStudy(BASE);
    await screen.findByRole("tablist", { name: "Study panels" });
    const depth = router.history.length;
    await user.click(screen.getByRole("tab", { name: "Compare" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ view: "compare" }));
    expect(router.history.length).toBe(depth);
    expect(JSON.parse(window.localStorage.getItem(STUDY_VIEW_STORAGE_KEY) ?? "null")).toBe("compare");
  });

  it("R3.26 the browser's last tab opens when the address names none, without rewriting the address", async () => {
    window.localStorage.setItem(STUDY_VIEW_STORAGE_KEY, JSON.stringify("hands"));
    const { router } = renderStudy(BASE);
    expect(await screen.findByRole("tab", { name: /^Hands/ })).toHaveAttribute("aria-selected", "true");
    expect(router.state.location.search).not.toHaveProperty("view");
  });

  it("R3.26 a fold-only node has no Compare tab and a view naming it opens Overview", async () => {
    const foldOnly = {
      ...fixtureRootNode,
      actions: fixtureRootNode.actions.slice(0, 1),
      range_by_action: [{ index: 0, share: 1 }],
      hands: fixtureRootNode.hands.map((row) => ({ ...row, strategy: [1], ev_bb: [0], loss_pct_pot: [0] })),
    };
    renderStudy(`${BASE}&view=compare`, (request) => (request.path === "/api/v1/study/node" ? nodeJson(foldOnly) : undefined));
    const tablist = await screen.findByRole("tablist", { name: "Study panels" });
    expect(within(tablist).queryByRole("tab", { name: "Compare" })).not.toBeInTheDocument();
    expect(within(tablist).getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("R3.26 the Hands tab carries its street as a badge", async () => {
    renderStudy(BASE);
    const hands = await screen.findByRole("tab", { name: /^Hands/ });
    expect(within(hands).getByTestId("tab-badge")).toHaveTextContent("Preflop");
  });

  it("R3.26 Compare lists each action's served loss for the hand and opens that lens on the matrix", async () => {
    const user = userEvent.setup();
    const { router } = renderStudy(`${BASE}&view=compare&hand=72o`);
    const panel = await screen.findByRole("tabpanel", { name: "Compare" });
    const row = fixtureRootNode.hands.find((candidate) => candidate.hand === "72o");
    if (row === undefined) throw new Error("fixture has no 72o");
    const list = within(panel).getByRole("list", { name: "72o against the best action" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(fixtureRootNode.actions.length);
    expect(list).toHaveTextContent(`Raise to 2.5bb: ${(row.loss_pct_pot[2] ?? 0).toFixed(2)}% of the pot behind the best`);
    await user.click(within(panel).getByRole("button", { name: "Compare Raise to 2.5bb on the matrix" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ mode: "compare", lens: "2", view: "compare" }));
  });

  it("R3.26 Compare without a hand asks for one", async () => {
    renderStudy(`${BASE}&view=compare`);
    const panel = await screen.findByRole("tabpanel", { name: "Compare" });
    expect(panel).toHaveTextContent("Pick a cell in the matrix to see what each action gives up against the best.");
  });

  it("R3.26 a matrix mode change keeps the open tab's body mounted", async () => {
    const user = userEvent.setup();
    renderStudy(BASE);
    const table = await screen.findByRole("table", { name: /Range by action at this node/ });
    await user.click(screen.getByRole("radio", { name: "EV" }));
    await screen.findByRole("img", { name: /expected value mode/ });
    expect(screen.getByRole("table", { name: /Range by action at this node/ })).toBe(table);
  });
});
