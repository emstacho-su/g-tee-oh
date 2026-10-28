/**
 * Tests for the RangeMatrix component (S24, S38, R3.12) in jsdom: the canvas is an image with a
 * label and a description that points at the screen-reader-only table (O-347, no visible
 * toggle), arrow keys move the focused cell and Enter or Space selects it, a click selects the
 * cell under the pointer, the pop-out opens and closes by mouse and keyboard (O-386), each mode
 * has its legend (O-384, O-385), drawing goes through one animation frame per change, and a
 * browser without a 2D context still renders the table without crashing.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POP_OUT_GAP_PX, popOutPosition } from "../../src/components/range-matrix/MatrixPopOut.js";
import { RangeMatrix } from "../../src/components/range-matrix/RangeMatrix.js";
import { fixtureStudyNode } from "../../src/fixtures/index.js";
import { formatBb, formatShare } from "../../src/poker/format.js";
import { fakePattern, recordingContext } from "./recording-context.js";

type FrameCallback = (time: number) => void;

const noop = (): void => undefined;

let frames: FrameCallback[] = [];

function flushFrames(): void {
  const pending = frames;
  frames = [];
  act(() => pending.forEach((callback) => callback(0)));
}

function stubContext(context: unknown): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => context as ReturnType<HTMLCanvasElement["getContext"]>,
  );
}

function grid(): HTMLElement {
  return screen.getByRole("group", { name: /range matrix cells/i });
}

interface FakeMatchMedia {
  /** The media queries that hold a change listener right now. */
  active(): string[];
  /** Calls the change listeners of one query, as the browser does when the ratio leaves it. */
  fire(query: string): void;
}

/** The inert matchMedia stub from test/setup.ts, put back after every test. */
const setupMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

/** Installs a matchMedia that records change listeners per query; replaced in afterEach. */
function installMatchMedia(): FakeMatchMedia {
  const listeners = new Map<string, Set<() => void>>();
  const listenersOf = (query: string): Set<() => void> => {
    const known = listeners.get(query) ?? new Set<() => void>();
    listeners.set(query, known);
    return known;
  };
  const matchMedia = (query: string) => ({
    media: query,
    matches: true,
    addEventListener: (_type: "change", listener: () => void) => listenersOf(query).add(listener),
    removeEventListener: (_type: "change", listener: () => void) => listenersOf(query).delete(listener),
  });
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: matchMedia });
  return {
    active: () => [...listeners].filter(([, set]) => set.size > 0).map(([query]) => query),
    fire: (query) => listenersOf(query).forEach((listener) => listener()),
  };
}

beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (setupMatchMedia !== undefined) Object.defineProperty(window, "matchMedia", setupMatchMedia);
});

describe("R3.12 RangeMatrix component", () => {
  it("R3.12 renders the canvas as an image labeled with the mode and described by the table", () => {
    stubContext(null);
    render(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={() => undefined} />);
    const image = screen.getByRole("img", { name: "Range matrix, frequency mode, 169 hands" });
    expect(image.tagName).toBe("CANVAS");
    const tableId = image.getAttribute("aria-describedby");
    expect(tableId).toBeTruthy();
    expect(document.getElementById(tableId ?? "")?.tagName).toBe("TABLE");
  });

  it("R3.12 sizes the backing store at the device pixel ratio and the box in CSS pixels", () => {
    stubContext(null);
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
    render(<RangeMatrix node={fixtureStudyNode} mode="ev" theme="dark" sizePx={390} onSelectHand={() => undefined} />);
    const canvas = screen.getByRole<HTMLCanvasElement>("img", { name: /expected value mode/i });
    expect(canvas.width).toBe(780);
    expect(canvas.height).toBe(780);
    expect(canvas.style.width).toBe("390px");
    // Never wider than its container (a phone), kept square.
    expect(canvas.style.maxWidth).toBe("100%");
    expect(canvas.style.aspectRatio).toBe("1 / 1");
  });

  it("R3.12 follows a device pixel ratio change, re-subscribing for the new ratio and unsubscribing on unmount", () => {
    stubContext(null);
    const ratio = vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(1);
    const media = installMatchMedia();
    const { unmount } = render(
      <RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" sizePx={390} onSelectHand={() => undefined} />,
    );
    const canvas = screen.getByRole<HTMLCanvasElement>("img");
    expect(canvas.width).toBe(390);
    expect(media.active()).toEqual(["(resolution: 1dppx)"]);
    ratio.mockReturnValue(2);
    act(() => media.fire("(resolution: 1dppx)"));
    expect(canvas.width).toBe(780);
    expect(canvas.height).toBe(780);
    expect(canvas.style.width).toBe("390px");
    expect(media.active()).toEqual(["(resolution: 2dppx)"]);
    unmount();
    expect(media.active()).toEqual([]);
  });

  it("R3.12 without matchMedia and with an unusable ratio the matrix draws at ratio 1", () => {
    stubContext(null);
    Reflect.deleteProperty(window, "matchMedia");
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(Number.NaN);
    render(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" sizePx={390} onSelectHand={() => undefined} />);
    expect(screen.getByRole<HTMLCanvasElement>("img").width).toBe(390);
  });

  it("R3.12 without a 2D context it renders the table and skips drawing without crashing", () => {
    stubContext(null);
    render(<RangeMatrix node={fixtureStudyNode} mode="weight" theme="light" onSelectHand={() => undefined} />);
    flushFrames();
    expect(screen.getByRole("table", { hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /range weight mode/i })).toBeInTheDocument();
  });

  it("R3.12 draws once per input change through requestAnimationFrame", () => {
    const { ctx, ops } = recordingContext();
    const tileMethods = { beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop };
    stubContext(Object.assign(ctx, tileMethods, { createPattern: () => fakePattern("tile") }));
    const { rerender } = render(
      <RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={() => undefined} />,
    );
    expect(ops).toHaveLength(0);
    flushFrames();
    const firstDraw = ops.length;
    expect(firstDraw).toBeGreaterThan(169);
    expect(ops.filter((op) => op.op === "fillText").map((op) => op.op === "fillText" && op.text)).toContain("AKs");
    rerender(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={() => undefined} />);
    flushFrames();
    expect(ops).toHaveLength(firstDraw);
    rerender(<RangeMatrix node={fixtureStudyNode} mode="ev" theme="light" onSelectHand={() => undefined} />);
    flushFrames();
    expect(ops.length).toBeGreaterThan(firstDraw);
  });

  it("R3.12 arrow keys move the focused cell, announce it, and Enter selects it", async () => {
    stubContext(null);
    const onSelectHand = vi.fn();
    render(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={onSelectHand} />);
    const wrapper = grid();
    expect(wrapper).toHaveAttribute("tabindex", "0");
    wrapper.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("status")).toHaveTextContent(/^AKs: /);
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("status")).toHaveTextContent(/^KK: /);
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowUp}{ArrowUp}");
    expect(screen.getByRole("status")).toHaveTextContent(/^AA: /);
    await userEvent.keyboard("{Enter}");
    expect(onSelectHand).toHaveBeenLastCalledWith("AA");
    await userEvent.keyboard("{ArrowDown}{ }");
    expect(onSelectHand).toHaveBeenLastCalledWith("AKo");
  });

  it("R3.12 keyboard focus stops at the grid edges and ignores other keys", async () => {
    stubContext(null);
    const onSelectHand = vi.fn();
    render(
      <RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" selectedHand="22" onSelectHand={onSelectHand} />,
    );
    grid().focus();
    await userEvent.keyboard("{ArrowRight}{ArrowDown}");
    expect(screen.getByRole("status")).toHaveTextContent(/^22: /);
    await userEvent.keyboard("a");
    expect(onSelectHand).not.toHaveBeenCalled();
  });

  it("R3.12 a click selects the cell under the pointer", () => {
    stubContext(null);
    const onSelectHand = vi.fn();
    render(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={onSelectHand} />);
    const canvas = screen.getByRole("img");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 10, y: 20, width: 520, height: 520 }));
    fireEvent.click(canvas, { clientX: 10 + 40 * 2 + 5, clientY: 20 + 40 * 1 + 5 });
    expect(onSelectHand).toHaveBeenCalledWith("KQs");
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    expect(onSelectHand).toHaveBeenCalledTimes(1);
  });

  it("R3.12 has no visible Show as table toggle; the table stays in the DOM for screen readers only (O-347)", () => {
    stubContext(null);
    render(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Show as table" })).not.toBeInTheDocument();
    const table = screen.getByRole("table", { hidden: true });
    expect(table.parentElement).toHaveClass("sr-only");
  });
});

/** The fixture's numbers for one hand, as the pop-out prints them. */
function rowOf(hand: string) {
  const row = fixtureStudyNode.hands.find((candidate) => candidate.hand === hand);
  if (row === undefined) throw new Error(`fixture has no ${hand}`);
  return row;
}

/** Clicks the cell at a grid row and column on a 520 pixel canvas placed at (10, 20). */
function clickCell(canvas: HTMLElement, row: number, col: number): void {
  fireEvent.click(canvas, { clientX: 10 + 40 * col + 5, clientY: 20 + 40 * row + 5 });
}

function placedCanvas(): HTMLElement {
  const canvas = screen.getByRole("img");
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 10, y: 20, width: 520, height: 520 }));
  return canvas;
}

describe("R3.12 RangeMatrix pop-out (O-386)", () => {
  it("R3.12 a click selects the cell and pops it out with each action's exact frequency and EV and the weight", () => {
    stubContext(null);
    const onSelectHand = vi.fn();
    render(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={onSelectHand} />);
    clickCell(placedCanvas(), 1, 2);
    expect(onSelectHand).toHaveBeenCalledWith("KQs");
    const popOut = screen.getByTestId("matrix-popout");
    expect(popOut).toHaveAttribute("data-hand", "KQs");
    const row = rowOf("KQs");
    fixtureStudyNode.actions.forEach((action, position) => {
      const line = within(popOut).getByTestId(`popout-action-${action.index}`);
      expect(line).toHaveTextContent(action.label);
      expect(line).toHaveTextContent(formatShare(row.strategy[position] ?? 0, 1));
      expect(line).toHaveTextContent(formatBb(row.ev_bb[position] ?? 0, 2));
    });
    expect(popOut).toHaveTextContent(`Range weight ${formatShare(row.reach?.[0] ?? 0, 1)}`);
    expect(popOut).toHaveClass("z-(--layer-tooltip)");
    expect(popOut).not.toHaveAttribute("tabindex");
  });

  it("R3.12 the next click anywhere closes it; a click on another cell opens that cell instead", () => {
    stubContext(null);
    render(<RangeMatrix node={fixtureStudyNode} mode="ev" theme="dark" onSelectHand={() => undefined} />);
    const canvas = placedCanvas();
    clickCell(canvas, 0, 0);
    expect(screen.getByTestId("matrix-popout")).toHaveAttribute("data-hand", "AA");
    clickCell(canvas, 0, 1);
    expect(screen.getByTestId("matrix-popout")).toHaveAttribute("data-hand", "AKs");
    clickCell(canvas, 0, 1);
    expect(screen.queryByTestId("matrix-popout")).not.toBeInTheDocument();
    clickCell(canvas, 2, 2);
    expect(screen.getByTestId("matrix-popout")).toHaveAttribute("data-hand", "QQ");
    fireEvent.click(document.body);
    expect(screen.queryByTestId("matrix-popout")).not.toBeInTheDocument();
  });

  it("R3.12 a click inside the pop-out also closes it", () => {
    stubContext(null);
    render(<RangeMatrix node={fixtureStudyNode} mode="weight" theme="light" onSelectHand={() => undefined} />);
    clickCell(placedCanvas(), 0, 0);
    fireEvent.click(screen.getByTestId("matrix-popout"));
    expect(screen.queryByTestId("matrix-popout")).not.toBeInTheDocument();
  });

  it("R3.12 Enter or Space opens it on the focused cell, Escape and the arrow keys close it, focus stays on the grid", async () => {
    stubContext(null);
    const onSelectHand = vi.fn();
    render(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={onSelectHand} />);
    grid().focus();
    await userEvent.keyboard("{ArrowRight}{Enter}");
    expect(onSelectHand).toHaveBeenLastCalledWith("AKs");
    expect(screen.getByTestId("matrix-popout")).toHaveAttribute("data-hand", "AKs");
    expect(grid()).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(/^AKs: Fold .*%, EV .*bb; .*range weight .*%$/);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("matrix-popout")).not.toBeInTheDocument();
    await userEvent.keyboard("{ }");
    expect(screen.getByTestId("matrix-popout")).toHaveAttribute("data-hand", "AKs");
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.queryByTestId("matrix-popout")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/^KK: /);
  });

  it("R3.12 Tab away closes it", async () => {
    stubContext(null);
    render(
      <>
        <RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={() => undefined} />
        <button type="button">after</button>
      </>,
    );
    grid().focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByTestId("matrix-popout")).toBeInTheDocument();
    await userEvent.tab();
    expect(screen.queryByTestId("matrix-popout")).not.toBeInTheDocument();
  });

  it("R3.12 popOut false keeps selection and never pops out", async () => {
    stubContext(null);
    const onSelectHand = vi.fn();
    render(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" popOut={false} onSelectHand={onSelectHand} />);
    clickCell(placedCanvas(), 0, 0);
    grid().focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelectHand).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("matrix-popout")).not.toBeInTheDocument();
  });

  it("R3.12 initialPopOutHand opens the pop-out on that hand, and a missing hand says not in range", () => {
    stubContext(null);
    const sparse = { ...fixtureStudyNode, hands: fixtureStudyNode.hands.filter((row) => row.hand !== "72o") };
    render(<RangeMatrix node={sparse} mode="frequency" theme="light" initialPopOutHand="72o" onSelectHand={() => undefined} />);
    const popOut = screen.getByTestId("matrix-popout");
    expect(popOut).toHaveAttribute("data-hand", "72o");
    expect(popOut).toHaveTextContent("not in range");
  });
});

describe("R3.12 pop-out placement", () => {
  const box = { boxW: 520, boxH: 520, popW: 180, popH: 200 };

  it("R3.12 sits beside the cell, on the right when it fits and on the left when not", () => {
    expect(popOutPosition({ row: 0, col: 0, ...box })).toEqual({ left: 40 + POP_OUT_GAP_PX, top: 0 });
    expect(popOutPosition({ row: 3, col: 12, ...box })).toEqual({ left: 480 - 180 - POP_OUT_GAP_PX, top: 120 });
  });

  it("R3.12 is clamped inside the matrix box, even on a phone-sized box", () => {
    expect(popOutPosition({ row: 12, col: 6, ...box })).toEqual({ left: 280 + POP_OUT_GAP_PX, top: 320 });
    const phone = popOutPosition({ row: 12, col: 6, boxW: 300, boxH: 300, popW: 180, popH: 200 });
    expect(phone.left).toBeGreaterThanOrEqual(0);
    expect(phone.left + 180).toBeLessThanOrEqual(300);
    expect(phone.top + 200).toBeLessThanOrEqual(300);
    expect(popOutPosition({ row: 5, col: 5, boxW: 100, boxH: 100, popW: 180, popH: 200 })).toEqual({ left: 0, top: 0 });
  });
});

describe("R3.12 RangeMatrix legends", () => {
  it("R3.12 frequency mode lists every action with its swatch, name and pattern", () => {
    stubContext(null);
    render(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={() => undefined} />);
    const legend = screen.getByRole("list", { name: "Action legend" });
    const items = within(legend).getAllByRole("listitem");
    expect(items).toHaveLength(fixtureStudyNode.actions.length);
    expect(items[2]).toHaveTextContent("Raise to 2.5bb");
    expect(items[2]).toHaveTextContent("diagonal pattern");
    expect(within(items[2] as HTMLElement).getByTestId("action-swatch")).toBeInTheDocument();
  });

  it("R3.12 EV mode shows the stepped scale with bb boundaries and a named neutral middle", () => {
    stubContext(null);
    render(<RangeMatrix node={fixtureStudyNode} mode="ev" theme="dark" onSelectHand={() => undefined} />);
    const legend = screen.getByRole("list", { name: /EV legend/ });
    expect(within(legend).getAllByRole("listitem")).toHaveLength(11);
    expect(legend).toHaveTextContent("near 0");
    expect(legend).toHaveTextContent(/more than \+\d/);
  });

  it("R3.12 weight mode shows the 0 to 100 percent ramp", () => {
    stubContext(null);
    render(<RangeMatrix node={fixtureStudyNode} mode="weight" theme="light" onSelectHand={() => undefined} />);
    const legend = screen.getByRole("list", { name: /Weight legend/ });
    expect(within(legend).getAllByRole("listitem")).toHaveLength(6);
    expect(legend).toHaveTextContent("more than 80% up to 100%");
  });
});
