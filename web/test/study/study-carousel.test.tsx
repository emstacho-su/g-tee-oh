// Tests for the /study position carousel on the rendered screen (S39, R3.12, O-354, O-393, O-395):
// the seats in action order with their states, the current seat's actions dropping down as
// buttons, an action pushing the child line, an acted seat reopening its decision, the next
// likely action marked and prefetched, and the current item brought into view.
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FIXTURE_CHILD_LINE,
  FIXTURE_GRANDCHILD_LINE,
  FIXTURE_ONLINE_STAKE_ID,
  FIXTURE_STUDY_CONFIG_ID,
  FIXTURE_STUDY_PAIR,
} from "../../src/fixtures/study.js";
import { studyNodeKey } from "../../src/study/queries.js";
import { renderStudy } from "./render-study.js";

const BASE = `/study?format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000&pair=${FIXTURE_STUDY_PAIR}`;

let spies: { mockRestore: () => void }[] = [];
// The strip scrolls itself (Element.scrollTo), never the page, so a phone does not jump.
let stripScroll: ReturnType<typeof vi.fn>;
const originalScrollTo = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTo");

beforeEach(() => {
  stripScroll = vi.fn();
  Object.defineProperty(Element.prototype, "scrollTo", { configurable: true, writable: true, value: stripScroll });
  spies = [
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null),
    vi.spyOn(console, "info").mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  spies.forEach((spy) => spy.mockRestore());
  if (originalScrollTo === undefined) Reflect.deleteProperty(Element.prototype, "scrollTo");
  else Object.defineProperty(Element.prototype, "scrollTo", originalScrollTo);
});

function seats(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Positions" })).getAllByRole("button");
}

function seat(name: RegExp): HTMLElement {
  return within(screen.getByRole("list", { name: "Positions" })).getByRole("button", { name });
}

describe("R3.12 position carousel", () => {
  it("R3.12 the seats run in action order: folds, the seat to act and the seat still waiting", async () => {
    renderStudy(BASE);
    await screen.findByRole("list", { name: "Positions" });
    expect(seats().map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^UTG.*Folds/),
      expect.stringMatching(/^HJ.*Folds/),
      expect.stringMatching(/^CO.*Folds/),
      expect.stringMatching(/^BTN.*To act/),
      expect.stringMatching(/^SB.*Folds/),
      expect.stringMatching(/^BB.*Waiting/),
    ]);
    const utg = seat(/^UTG/);
    expect(utg).toHaveAttribute("aria-disabled", "true");
    expect(utg).toHaveAccessibleName(/Outside this pair's solution/);
    expect(seat(/^BB/)).toHaveAccessibleName(/Acts after BTN/);
    const btn = seat(/^BTN/);
    expect(btn).toHaveAttribute("aria-current", "step");
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "BTN's range at this node" })).toBeInTheDocument();
  });

  it("R3.12 the seat to act drops down its actions as buttons; an ending action is disabled with its reason", async () => {
    renderStudy(BASE);
    const actions = await screen.findByRole("region", { name: "BTN's actions" });
    expect(seat(/^BTN/)).toHaveAttribute("aria-controls", actions.id);
    const fold = within(actions).getByRole("button", { name: /^Fold/ });
    expect(fold).toHaveAttribute("aria-disabled", "true");
    expect(fold).toHaveAccessibleName(/Ends the solution/);
    expect(within(actions).getByRole("button", { name: /^Raise 2\.5bb.*next likely/ })).not.toHaveAttribute("aria-disabled");
    expect(within(actions).queryByRole("link")).toBeNull();
  });

  it("R3.12 choosing an action pushes the child line and the next seat comes to act", async () => {
    const info = vi.mocked(console.info);
    const user = userEvent.setup();
    const { router } = renderStudy(BASE);
    const actions = await screen.findByRole("region", { name: "BTN's actions" });
    await user.click(within(actions).getByRole("button", { name: /^Raise 2\.5bb/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ line: FIXTURE_CHILD_LINE }));
    expect(await screen.findByText(/BB to act/)).toBeInTheDocument();
    await waitFor(() => expect(seat(/^BB/)).toHaveAttribute("aria-current", "step"));
    expect(seat(/^BTN/)).toHaveTextContent("Raise 2.5bb");
    expect(await screen.findByRole("region", { name: "BB's actions" })).toBeInTheDocument();
    await waitFor(() => expect(info.mock.calls.some(([line]) => String(line).endsWith(` ${FIXTURE_CHILD_LINE}`))).toBe(true));

    router.history.back();
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("line"));
    expect(await screen.findByText(/BTN to act/)).toBeInTheDocument();
  });

  it("R3.12 the current seat toggles its drop-down", async () => {
    const user = userEvent.setup();
    renderStudy(BASE);
    await screen.findByRole("region", { name: "BTN's actions" });
    await user.click(seat(/^BTN/));
    expect(seat(/^BTN/)).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "BTN's actions" })).not.toBeInTheDocument();
    await user.click(seat(/^BTN/));
    expect(await screen.findByRole("region", { name: "BTN's actions" })).toBeInTheDocument();
  });

  it("R3.12 a seat that acted reopens its decision and shows that seat's range", async () => {
    const user = userEvent.setup();
    const { router } = renderStudy(`${BASE}&line=${FIXTURE_CHILD_LINE}`);
    await screen.findByText(/BB to act/);
    await waitFor(() => expect(seat(/^BTN/)).toHaveTextContent("Raise 2.5bb"));
    await user.click(seat(/^BTN/));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("line"));
    expect(await screen.findByRole("heading", { name: "BTN's range at this node" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "BTN's actions" })).toBeInTheDocument();
  });

  it("R3.12 a decision past the first orbit gets its own item, and the synthetic banner still shows", async () => {
    renderStudy(`${BASE}&line=${FIXTURE_GRANDCHILD_LINE}`);
    await screen.findByText(/BTN to act/);
    await waitFor(() => expect(seats()).toHaveLength(7));
    expect(seats()[5]).toHaveTextContent(/^BB.*Raise 11bb/);
    expect(seats()[6]).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("synthetic-banner")).toBeInTheDocument();
  });

  it("R3.12 the next likely action's node is prefetched before any click", async () => {
    const { queryClient, nodeRequests } = renderStudy(BASE);
    await screen.findByRole("region", { name: "BTN's actions" });
    const key = studyNodeKey({ configId: FIXTURE_STUDY_CONFIG_ID, pair: FIXTURE_STUDY_PAIR, line: FIXTURE_CHILD_LINE });
    await waitFor(() => expect(queryClient.getQueryData(key)).toBeDefined());
    expect(nodeRequests().map((request) => request.query["line"])).toEqual([undefined, FIXTURE_CHILD_LINE]);
  });

  it("R3.12 the strip scrolls the current seat into view, smoothly unless reduced motion is asked for", async () => {
    const user = userEvent.setup();
    renderStudy(BASE);
    const actions = await screen.findByRole("region", { name: "BTN's actions" });
    await waitFor(() => expect(stripScroll).toHaveBeenCalled());
    expect(stripScroll.mock.contexts.at(-1)).toBe(screen.getByTestId("position-strip"));
    expect(stripScroll.mock.calls.at(-1)?.[0]).toEqual({ left: 0, behavior: "smooth" });

    stripScroll.mockClear();
    await user.click(within(actions).getByRole("button", { name: /^Raise 2\.5bb/ }));
    await screen.findByRole("region", { name: "BB's actions" });
    await waitFor(() => expect(stripScroll).toHaveBeenCalled());
  });

  it("R3.12 under reduced motion the current seat jumps into view", async () => {
    const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("reduce"),
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    spies.push(matchMedia);
    renderStudy(BASE);
    await screen.findByRole("region", { name: "BTN's actions" });
    await waitFor(() => expect(stripScroll).toHaveBeenCalled());
    expect(stripScroll.mock.calls.at(-1)?.[0]).toMatchObject({ behavior: "auto" });
  });
});
