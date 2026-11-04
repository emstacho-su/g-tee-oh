/**
 * Tests for the hovered-hand store (S45 follow-up, R3.25, code review 3): the matrix writes the hand
 * under the pointer into a small store and only the components that show it (the hand row and the
 * Compare tab) subscribe, so a hover no longer re-renders the whole node view. A write of the same
 * hand notifies nobody.
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createHoverStore, useHoveredHand } from "../../src/study/hover-store.js";

describe("R3.25 the hovered-hand store", () => {
  it("R3.25 holds the hovered hand, notifies its subscribers on a change and not on a repeat", () => {
    const store = createHoverStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.get()).toBeNull();
    store.set("AKs");
    store.set("AKs");
    expect(store.get()).toBe("AKs");
    expect(listener).toHaveBeenCalledTimes(1);
    store.set(null);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.set("QQ");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("R3.25 useHoveredHand re-renders only its own component", () => {
    const store = createHoverStore();
    let parentRenders = 0;
    let childRenders = 0;
    function Child() {
      childRenders += 1;
      return <p data-testid="hovered">{useHoveredHand(store) ?? "none"}</p>;
    }
    function Parent() {
      parentRenders += 1;
      return <Child />;
    }
    render(<Parent />);
    act(() => store.set("AKs"));
    expect(screen.getByTestId("hovered")).toHaveTextContent("AKs");
    expect(parentRenders).toBe(1);
    expect(childRenders).toBe(2);
  });
});
