/**
 * The library screens' injected dependencies (S28, R3.4, R3.5, O-297): how an event stream is
 * opened and how an Idempotency-Key is made. The app opens a browser EventSource on its own
 * origin (the session cookie rides along) and uses crypto.randomUUID; a test puts a fake stream
 * and a counter in the provider, since jsdom has no EventSource.
 */
import { createContext, useContext, type ReactNode } from "react";

import { createKeyFactory, type KeyFactory } from "../trainer/idempotency.js";

/** The part of the browser EventSource the screen uses. */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export interface LibraryDeps {
  openEvents: EventSourceFactory;
  newKey: KeyFactory;
}

/** EventSource.CLOSED; a stream that never opens reports it, so the screen offers a reconnect. */
const CLOSED = 2;

/**
 * The browser's EventSource on the page's own origin. Where none exists (a test environment
 * such as jsdom) the stream is a closed one that never fires, and the screen says live updates
 * stopped instead of failing to render.
 */
export function openBrowserEvents(url: string): EventSourceLike {
  if (typeof EventSource === "undefined") {
    return { readyState: CLOSED, addEventListener: () => undefined, close: () => undefined };
  }
  return new EventSource(url);
}

export const defaultLibraryDeps: LibraryDeps = {
  openEvents: openBrowserEvents,
  newKey: createKeyFactory(),
};

const LibraryDepsContext = createContext<LibraryDeps>(defaultLibraryDeps);

export interface LibraryDepsProviderProps {
  deps: LibraryDeps;
  children: ReactNode;
}

export function LibraryDepsProvider({ deps, children }: LibraryDepsProviderProps) {
  return <LibraryDepsContext.Provider value={deps}>{children}</LibraryDepsContext.Provider>;
}

export function useLibraryDeps(): LibraryDeps {
  return useContext(LibraryDepsContext);
}
