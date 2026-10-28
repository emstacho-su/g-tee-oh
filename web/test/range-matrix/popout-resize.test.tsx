/**
 * The pop-out follows the matrix box (S38 review round 1, finding 9; O-386): its position is
 * measured again when the matrix box or the pop-out itself changes size (a ResizeObserver over
 * both), always clamped inside the box. jsdom has neither layout nor ResizeObserver, so the test
 * gives elements their sizes and installs a fake observer it can fire.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MatrixPopOut, popOutPosition } from "../../src/components/range-matrix/MatrixPopOut.js";
import { buildMatrixModel } from "../../src/components/range-matrix/model.js";
import { fixtureStudyNode } from "../../src/fixtures/index.js";

interface Size {
  w: number;
  h: number;
}

const sizes = new Map<string, Size>();
const observers: FakeObserver[] = [];

class FakeObserver {
  readonly targets: Element[] = [];
  constructor(private readonly callback: () => void) {
    observers.push(this);
  }
  observe(target: Element): void {
    this.targets.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    this.targets.length = 0;
  }
  fire(): void {
    this.callback();
  }
}

function sizeOf(element: HTMLElement): Size {
  return sizes.get(element.dataset.testid ?? "") ?? { w: 0, h: 0 };
}

const DIMENSIONS = {
  clientWidth: (element: HTMLElement) => sizeOf(element).w,
  clientHeight: (element: HTMLElement) => sizeOf(element).h,
  offsetWidth: (element: HTMLElement) => sizeOf(element).w,
  offsetHeight: (element: HTMLElement) => sizeOf(element).h,
} as const;
const originals = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  for (const [name, read] of Object.entries(DIMENSIONS)) {
    originals.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return read(this);
      },
    });
  }
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: FakeObserver });
});

afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, name);
    else Object.defineProperty(HTMLElement.prototype, name, descriptor);
  }
  Reflect.deleteProperty(globalThis, "ResizeObserver");
  sizes.clear();
  observers.length = 0;
});

describe("R3.12 the pop-out is measured again when the matrix or the pop-out resizes (review round 1, 9)", () => {
  it("R3.12 a smaller matrix box moves the pop-out, still clamped inside it", () => {
    const model = buildMatrixModel(fixtureStudyNode);
    const cell = model.cells.find((candidate) => candidate.row === 3 && candidate.col === 12);
    if (cell === undefined) throw new Error("no cell at row 3, column 12");
    sizes.set("box", { w: 520, h: 520 });
    sizes.set("matrix-popout", { w: 240, h: 200 });
    render(
      <div data-testid="box" className="relative">
        <MatrixPopOut cell={cell} actions={model.actions} mode="frequency" theme="light" evScaleBb={model.evScaleBb} />
      </div>,
    );
    const popOut = screen.getByTestId("matrix-popout");
    const first = popOutPosition({ row: 3, col: 12, boxW: 520, boxH: 520, popW: 240, popH: 200 });
    expect(popOut.style.left).toBe(`${first.left}px`);
    const observed = observers.flatMap((observer) => observer.targets);
    expect(observed).toContain(popOut);
    expect(observed).toContain(screen.getByTestId("box"));

    // The phone turns, or the column narrows: the box shrinks, then the pop-out grows taller.
    sizes.set("box", { w: 300, h: 300 });
    sizes.set("matrix-popout", { w: 240, h: 260 });
    act(() => {
      for (const observer of observers) observer.fire();
    });
    const second = popOutPosition({ row: 3, col: 12, boxW: 300, boxH: 300, popW: 240, popH: 260 });
    expect(popOut.style.left).toBe(`${second.left}px`);
    expect(popOut.style.top).toBe(`${second.top}px`);
    expect(second.left + 240).toBeLessThanOrEqual(300);
    expect(second.top + 260).toBeLessThanOrEqual(300);
  });
});
