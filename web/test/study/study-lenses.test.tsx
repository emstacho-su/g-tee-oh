/**
 * Tests for the lenses on the study screen (R3.24, O-462 to O-465) and their address parameters:
 * the mode switch offers the two lenses, the compare action picker writes the lens to the address
 * with replace and is usable on its own, the lens line names what the matrix shows, and the
 * scale-by-weight checkbox starts from the node's rule and can be overridden for the page.
 */
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_ONLINE_STAKE_ID, FIXTURE_STUDY_PAIR, fixtureRootNode } from "../../src/fixtures/study.js";
import { withLens } from "../../src/study/filters.js";
import { STUDY_MODES, validateStudySearch } from "../../src/study/search.js";
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

describe("R3.24 lens parameters", () => {
  it("R3.24 the study modes hold the two lenses and the lens is a small integer", () => {
    expect(STUDY_MODES).toEqual(["frequency", "ev", "weight", "strategy_ev", "compare"]);
    expect(validateStudySearch({ mode: "compare", lens: "2" })).toEqual({ mode: "compare", lens: 2 });
    expect(validateStudySearch({ mode: "strategy_ev" })).toEqual({ mode: "strategy_ev" });
    expect(validateStudySearch({ lens: "x" })).toEqual({});
    expect(validateStudySearch({ lens: "-1" })).toEqual({});
    expect(validateStudySearch({ lens: "256" })).toEqual({});
  });

  it("R3.24 withLens sets the lens and keeps everything else", () => {
    expect(withLens({ pair: "BB-BTN", mode: "compare" }, 3)).toEqual({ pair: "BB-BTN", mode: "compare", lens: 3 });
  });
});

describe("R3.24 lenses on the study screen", () => {
  it("R3.24 the mode switch offers both lenses and the lens line names the one shown", async () => {
    const user = userEvent.setup();
    const { router } = renderStudy(BASE);
    expect(await screen.findByRole("img", { name: /frequency mode/ })).toBeInTheDocument();
    expect(screen.getByTestId("lens-line")).toHaveTextContent("Lens: frequency");
    await user.click(screen.getByRole("radio", { name: "Strategy with EV" }));
    expect(await screen.findByRole("img", { name: /strategy with EV mode/ })).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({ mode: "strategy_ev" });
    expect(screen.getByTestId("lens-line")).toHaveTextContent("Lens: strategy with EV, EV in big blinds");
    await user.click(screen.getByRole("radio", { name: "EV" }));
    await screen.findByRole("img", { name: /expected value mode/ });
    expect(screen.getByTestId("lens-line")).toHaveTextContent("Lens: expected value, EV in big blinds");
  });

  it("R3.24 Compare to Best shows the action picker, defaults to the first non-fold action and writes the lens with replace", async () => {
    const user = userEvent.setup();
    const { router } = renderStudy(`${BASE}&mode=compare`);
    expect(await screen.findByRole("img", { name: /compare to best mode/ })).toBeInTheDocument();
    const picker = screen.getByRole("radiogroup", { name: "Compare action" });
    expect(picker).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Call" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("lens-line")).toHaveTextContent("Lens: compare to best, Call against the best action, in percent of the pot");
    const depth = router.history.length;
    await user.click(screen.getByRole("radio", { name: "Raise to 2.5bb" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ mode: "compare", lens: "2" }));
    expect(router.history.length).toBe(depth);
    expect(screen.getByTestId("lens-line")).toHaveTextContent("Raise to 2.5bb against the best action");
    expect(screen.queryByRole("radio", { name: "Fold" })).toBeInTheDocument();
  });

  it("R3.24 a lens that names no action at this node falls back to the default without rewriting the address", async () => {
    const { router } = renderStudy(`${BASE}&mode=compare&lens=9`);
    expect(await screen.findByRole("img", { name: /compare to best mode/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Call" })).toHaveAttribute("aria-checked", "true");
    // The router keeps the raw string in its location; the screen validates it to a number.
    expect(router.state.location.search).toMatchObject({ lens: "9" });
  });

  it("R3.24 the scale-by-weight checkbox starts on for a node with partial reach, off for full reach, and can be flipped", async () => {
    const user = userEvent.setup();
    renderStudy(BASE);
    const box = await screen.findByRole("checkbox", { name: "Scale bars by range weight" });
    expect(box).toBeChecked();
    await user.click(box);
    expect(box).not.toBeChecked();
  });

  it("R3.24 the checkbox is off by default when every hand is fully in the range, and hidden outside the bar lenses", async () => {
    const user = userEvent.setup();
    const full = { ...fixtureRootNode, hands: fixtureRootNode.hands.map((row) => ({ ...row, reach: [1, 1] })) };
    renderStudy(BASE, (request) => (request.path === "/api/v1/study/node" ? nodeJson(full) : undefined));
    const box = await screen.findByRole("checkbox", { name: "Scale bars by range weight" });
    expect(box).not.toBeChecked();
    await user.click(screen.getByRole("radio", { name: "EV" }));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Scale bars by range weight" })).not.toBeInTheDocument());
  });
});
