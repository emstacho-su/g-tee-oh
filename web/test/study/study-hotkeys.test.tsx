/**
 * Tests for the Study keyboard scope (S45, R3.12, O-466, O-467): Left opens the line one decision
 * back, Right the next likely line, Home the pair's root, M cycles the matrix mode with replace, S
 * opens the spot settings, Escape clears the action filters, Up and Down step to the neighbouring
 * covered depth at the same line; each is inert where it has nothing to do. A key the range matrix
 * grid already handled never reaches a hotkey (the one-line dispatch rule), the rows reach the ?
 * overlay and the settings table, LineEscape shows under the carousel on every node past the root,
 * and the current seat button carries a chevron that follows its drop-down.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_CHILD_LINE, FIXTURE_ONLINE_STAKE_ID, FIXTURE_STUDY_PAIR } from "../../src/fixtures/study.js";
import { createHotkeyStore, defaultHotkeyStore, handleKeydown } from "../../src/hotkeys/index.js";
import { HOTKEY_ROWS } from "../../src/routes/settings/hotkey-table.js";
import { STUDY_HOTKEY_ROWS, STUDY_SCOPE } from "../../src/study/study-hotkeys.js";
import { renderStudy } from "./render-study.js";

/** Multi-step flows through the whole app; under a full parallel run they need more than the 5 s default. */
const FLOW_TIMEOUT_MS = 15_000;
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
  // The app's hotkey store outlives a render; an overlay left open would hide the next test's screen.
  defaultHotkeyStore.getState().setOverlayOpen(false);
});

function press(key: string): void {
  fireEvent.keyDown(document.body, { key });
}

async function matrixShown(): Promise<void> {
  await screen.findByRole("img", { name: /^Range matrix/ });
}

describe("R3.12 Study keys move along the line", () => {
  it("R3.12 Right follows the next likely action, Left steps back one decision, R returns to the root", async () => {
    const { router } = renderStudy(BASE);
    await matrixShown();
    await screen.findByRole("region", { name: /'s actions$/ });
    press("ArrowRight");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ line: FIXTURE_CHILD_LINE }));
    await matrixShown();
    press("ArrowLeft");
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("line"));
    await matrixShown();
    press("ArrowRight");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ line: FIXTURE_CHILD_LINE }));
    await matrixShown();
    press("r");
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("line"));
  }, FLOW_TIMEOUT_MS);

  it("R3.12 at the root Left and R do nothing", async () => {
    const { router } = renderStudy(BASE);
    await matrixShown();
    const before = router.state.location.href;
    press("ArrowLeft");
    press("r");
    expect(router.state.location.href).toBe(before);
  });

  it("R3.12 a key the matrix grid handled never reaches a hotkey", async () => {
    const { router } = renderStudy(BASE);
    await matrixShown();
    const grid = screen.getByRole("group", { name: /range matrix cells/i });
    grid.focus();
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(screen.getByRole("status")).toHaveTextContent(/^AKs: /);
    expect(router.state.location.search).not.toHaveProperty("line");
  });

  it("R3.12 Escape with the matrix pop-out open closes the pop-out and keeps the action filters", async () => {
    const { router } = renderStudy(`${BASE}&filters=2`);
    await matrixShown();
    const grid = screen.getByRole("group", { name: /range matrix cells/i });
    grid.focus();
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(await screen.findByTestId("matrix-popout")).toBeInTheDocument();
    fireEvent.keyDown(grid, { key: "Escape" });
    expect(screen.queryByTestId("matrix-popout")).not.toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({ filters: "2" });
  });

  it("R3.12 a bare ArrowUp, ArrowDown or Home keeps scrolling the page: no Study key takes it (code review)", async () => {
    const { router } = renderStudy(`${BASE}&line=${FIXTURE_CHILD_LINE}`);
    await matrixShown();
    await waitFor(() => expect(screen.getByTestId("depth-steps")).toHaveAttribute("data-deeper", "20000"));
    const before = router.state.location.href;
    for (const key of ["ArrowUp", "ArrowDown", "Home", "End", "PageDown"]) {
      // fireEvent returns false when a listener called preventDefault.
      expect(fireEvent.keyDown(document.body, { key }), key).toBe(true);
    }
    expect(router.state.location.href).toBe(before);
  });

  it("R3.12 dispatch leaves a keydown alone once a control prevented it", () => {
    const store = createHotkeyStore();
    const handler = vi.fn();
    store.getState().register({ key: "ArrowLeft", description: "Back", scope: STUDY_SCOPE, handler });
    const event = new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true });
    event.preventDefault();
    expect(handleKeydown(store, event)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("R3.12 Study keys change the view", () => {
  it("R3.12 M cycles the matrix mode with replace, wrapping to frequency", async () => {
    const { router } = renderStudy(`${BASE}&mode=compare`);
    await matrixShown();
    const depth = router.history.length;
    press("m");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ mode: "frequency" }));
    press("M");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ mode: "ev" }));
    expect(router.history.length).toBe(depth);
  });

  it("R3.12 S opens the spot settings", async () => {
    renderStudy(BASE);
    await matrixShown();
    press("s");
    expect(await screen.findByRole("region", { name: "Spot settings" })).toBeInTheDocument();
  });

  it("R3.12 Escape clears the action filters and does nothing without them", async () => {
    const { router } = renderStudy(`${BASE}&filters=2`);
    await matrixShown();
    press("Escape");
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("filters"));
    const before = router.state.location.href;
    press("Escape");
    expect(router.state.location.href).toBe(before);
  });

  it("R3.12 ] steps to the deeper covered depth and [ back, keeping the mode and hand (O-467)", async () => {
    const { router } = renderStudy(`${BASE}&mode=ev&hand=AKs`);
    await matrixShown();
    await waitFor(() => expect(screen.getByTestId("depth-steps")).toHaveAttribute("data-deeper", "20000"));
    press("]");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ depth: "20000", mode: "ev", hand: "AKs" }));
    await matrixShown();
    await waitFor(() => expect(screen.getByTestId("depth-steps")).toHaveAttribute("data-shallower", "10000"));
    press("[");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ depth: "10000", mode: "ev", hand: "AKs" }));
  });
});

describe("R3.12 the Study rows are listed", () => {
  it("R3.12 the ? overlay lists the Study keys live at this node, and only those", async () => {
    const user = userEvent.setup();
    renderStudy(`${BASE}&line=${FIXTURE_CHILD_LINE}`);
    await matrixShown();
    await user.keyboard("?");
    const overlay = await screen.findByTestId("shortcuts-overlay");
    const section = within(overlay).getByRole("region", { name: STUDY_SCOPE });
    for (const description of ["Back one decision", "Back to the start of this spot", "Cycle the matrix lens", "Open the spot settings"]) {
      expect(section).toHaveTextContent(description);
    }
    expect(section).not.toHaveTextContent("Clear the action filters");
  });

  it("R3.12 the settings hotkey table lists every Study row", () => {
    for (const row of STUDY_HOTKEY_ROWS) expect(HOTKEY_ROWS).toContainEqual(row);
    expect(STUDY_HOTKEY_ROWS.map((row) => row.key)).toEqual(["ArrowLeft", "ArrowRight", "R", "]", "[", "M", "S", "Escape"]);
  });
});

describe("R3.12 back controls and the seat chevron", () => {
  it("R3.12 LineEscape shows under the carousel on a node past the root and not at the root", async () => {
    renderStudy(`${BASE}&line=${FIXTURE_CHILD_LINE}`);
    await matrixShown();
    expect(await screen.findByRole("button", { name: "Back to the start of this spot" })).toBeInTheDocument();
  });

  it("R3.12 at the root there is no LineEscape", async () => {
    renderStudy(BASE);
    await matrixShown();
    await screen.findByRole("region", { name: /'s actions$/ });
    expect(screen.queryByRole("button", { name: "Back to the start of this spot" })).not.toBeInTheDocument();
  });

  it("R3.12 the current seat button shows a chevron that turns with its drop-down", async () => {
    const user = userEvent.setup();
    renderStudy(BASE);
    const positions = await screen.findByRole("list", { name: "Positions" });
    const current = within(positions).getByRole("button", { expanded: true });
    const chevron = within(current).getByTestId("seat-chevron");
    expect(chevron).toHaveAttribute("data-open", "true");
    await user.click(current);
    expect(within(current).getByTestId("seat-chevron")).toHaveAttribute("data-open", "false");
    expect(within(positions).getAllByTestId("seat-chevron")).toHaveLength(1);
  });
});
