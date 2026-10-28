/**
 * The progress charts' tooltip placement (S32, R4.12, O-320): nothing without an anchor, above the
 * trigger by default, below it near the viewport top, the centre clamped away from the edges on a
 * normal viewport and left unclamped on a viewport too narrow to clamp in.
 */
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChartTooltip, useTooltipAnchor, type TooltipAnchor } from "../../src/components/progress/ChartTooltip.js";

const ORIGINAL_WIDTH = window.innerWidth;

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

function tooltip(): HTMLElement {
  return screen.getByRole("tooltip");
}

afterEach(() => setViewportWidth(ORIGINAL_WIDTH));

describe("R4.12 ChartTooltip placement (O-320)", () => {
  it("R4.12 renders nothing without an anchor", () => {
    render(<ChartTooltip anchor={null}>text</ChartTooltip>);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("R4.12 opens above a trigger lower on the page, centred on it", () => {
    setViewportWidth(1440);
    const anchor: TooltipAnchor = { left: 400, top: 500, bottom: 520, width: 40 };
    render(<ChartTooltip anchor={anchor}>above</ChartTooltip>);
    expect(tooltip()).toHaveTextContent("above");
    expect(tooltip().style.left).toBe("420px");
    expect(tooltip().style.top).toBe("494px");
    expect(tooltip().style.transform).toBe("translate(-50%, -100%)");
  });

  it("R4.12 is a sighted echo only: no id for a describedby link (S36 follow-up)", () => {
    setViewportWidth(1440);
    render(<ChartTooltip anchor={{ left: 400, top: 500, bottom: 520, width: 40 }}>echo</ChartTooltip>);
    expect(tooltip()).not.toHaveAttribute("id");
  });

  it("R4.12 opens below a trigger near the viewport top", () => {
    setViewportWidth(1440);
    const anchor: TooltipAnchor = { left: 400, top: 40, bottom: 60, width: 40 };
    render(<ChartTooltip anchor={anchor}>below</ChartTooltip>);
    expect(tooltip().style.top).toBe("66px");
    expect(tooltip().style.transform).toBe("translateX(-50%)");
  });

  it("R4.12 clamps the centre away from both edges at phone width", () => {
    setViewportWidth(390);
    const { rerender } = render(<ChartTooltip anchor={{ left: 0, top: 500, bottom: 520, width: 20 }}>edge</ChartTooltip>);
    expect(tooltip().style.left).toBe("112px");
    rerender(<ChartTooltip anchor={{ left: 380, top: 500, bottom: 520, width: 10 }}>edge</ChartTooltip>);
    expect(tooltip().style.left).toBe("278px");
  });

  it("R4.12 leaves the centre unclamped on a viewport narrower than two margins", () => {
    setViewportWidth(200);
    render(<ChartTooltip anchor={{ left: 10, top: 500, bottom: 520, width: 20 }}>narrow</ChartTooltip>);
    expect(tooltip().style.left).toBe("20px");
  });

  it("R4.12 useTooltipAnchor keeps the trigger's box while shown and clears it on hide", () => {
    const { result } = renderHook(() => useTooltipAnchor());
    expect(result.current.anchor).toBeNull();
    const element = document.createElement("button");
    element.getBoundingClientRect = () => ({ left: 5, top: 6, bottom: 26, width: 30, right: 35, height: 20, x: 5, y: 6, toJSON: () => ({}) });
    act(() => result.current.show(element));
    expect(result.current.anchor).toEqual({ left: 5, top: 6, bottom: 26, width: 30 });
    act(() => result.current.hide());
    expect(result.current.anchor).toBeNull();
  });
});
