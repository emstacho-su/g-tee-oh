/**
 * The hovered hand on the study screen (S45 follow-up, R3.25, code review 3). Hover is the
 * fastest-changing input on the page, so it lives outside React state: the range matrix writes the
 * hand under the pointer here, and only the components that show it, the hand row and the Compare
 * tab, subscribe through useHoveredHand. A hover therefore re-renders those two and nothing else:
 * not the node view, the matrix, the tabs or the range table. Writing the hand already held
 * notifies nobody. One store per node view; it holds no data beyond a hand class name.
 */
import { useSyncExternalStore } from "react";

export interface HoverStore {
  readonly get: () => string | null;
  readonly set: (hand: string | null) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createHoverStore(): HoverStore {
  let hovered: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => hovered,
    set: (hand) => {
      if (hand === hovered) return;
      hovered = hand;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The hovered hand, re-rendering only the calling component when it changes. */
export function useHoveredHand(store: HoverStore): string | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
