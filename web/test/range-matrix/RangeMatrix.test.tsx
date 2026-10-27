/**
 * Tests for the RangeMatrix component (S24, R3.12) in jsdom: the canvas is an image with a label
 * and a description that points at the table fallback, arrow keys move the focused cell and
 * Enter or Space selects it, a click selects the cell under the pointer, the toggle reveals the
 * table, drawing goes through one animation frame per change, and a browser without a 2D
 * context still renders the table without crashing.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RangeMatrix } from "../../src/components/range-matrix/RangeMatrix.js";
import { fixtureStudyNode } from "../../src/fixtures/index.js";
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

  it("R3.12 the toggle reveals the table and reports its state through aria-pressed", async () => {
    stubContext(null);
    render(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={() => undefined} />);
    const toggle = screen.getByRole("button", { name: "Show as table" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    const table = screen.getByRole("table", { hidden: true });
    expect(table.closest("[data-table-visible]")).toHaveAttribute("data-table-visible", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(table.closest("[data-table-visible]")).toHaveAttribute("data-table-visible", "true");
  });
});
