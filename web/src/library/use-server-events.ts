/**
 * One SSE stream while the library screen is mounted (S28, R3.4, R3.5, O-243, O-297).
 *
 * Mechanism: on mount the hook opens GET /api/v1/events through the injected factory and closes
 * it on unmount, so a tab holds one of the four streams the api allows per user only while
 * /library is open. Each named event is parsed (events.ts) and a valid payload goes to the latest
 * handler (kept in a ref, so a re-render never reopens the stream). The status follows the
 * stream: "open" after its open event; "connecting" while the browser retries after an error (it
 * does so on its own, at the api's retry interval); "closed" once the browser gives up, which it
 * does when the api answers with an error status, for example a 401 after the session ended, or
 * once MAX_CONSECUTIVE_STREAM_ERRORS errors arrive with no open between them, when the hook
 * closes the stream itself. reconnect() opens a fresh stream after that.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  EVENT_NAMES,
  EVENTS_PATH,
  parseBuilderState,
  parseBuildProgress,
  parseCoverageAdded,
  type BuilderStateEvent,
  type BuildProgressEvent,
  type CoverageAddedEvent,
} from "./events.js";
import { useLibraryDeps } from "./library-deps.js";

export type StreamStatus = "connecting" | "open" | "closed";

/** EventSource.CLOSED, written out so the module never touches the global in a test. */
export const EVENT_SOURCE_CLOSED = 2;
/**
 * Errors in a row, with no open between them, after which the screen stops the browser's own
 * retries and offers Reconnect instead (PR #28 security review): a stream the api keeps refusing
 * is not retried every few seconds for as long as the page stays open.
 */
export const MAX_CONSECUTIVE_STREAM_ERRORS = 3;

export interface ServerEventHandlers {
  onCoverageAdded?: (event: CoverageAddedEvent) => void;
  onBuilderState?: (event: BuilderStateEvent) => void;
  onBuildProgress?: (event: BuildProgressEvent) => void;
}

export interface ServerEvents {
  status: StreamStatus;
  reconnect: () => void;
}

export function useServerEvents(handlers: ServerEventHandlers): ServerEvents {
  const { openEvents } = useLibraryDeps();
  const latest = useRef(handlers);
  latest.current = handlers;
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const source = openEvents(EVENTS_PATH);
    let consecutiveErrors = 0;
    setStatus(source.readyState === EVENT_SOURCE_CLOSED ? "closed" : "connecting");
    source.addEventListener("open", () => {
      consecutiveErrors = 0;
      setStatus("open");
    });
    source.addEventListener("error", () => {
      consecutiveErrors += 1;
      if (source.readyState === EVENT_SOURCE_CLOSED || consecutiveErrors >= MAX_CONSECUTIVE_STREAM_ERRORS) {
        source.close();
        setStatus("closed");
        return;
      }
      setStatus("connecting");
    });
    source.addEventListener(EVENT_NAMES.coverageAdded, (event) => {
      const parsed = parseCoverageAdded(event.data);
      if (parsed !== null) latest.current.onCoverageAdded?.(parsed);
    });
    source.addEventListener(EVENT_NAMES.builderState, (event) => {
      const parsed = parseBuilderState(event.data);
      if (parsed !== null) latest.current.onBuilderState?.(parsed);
    });
    source.addEventListener(EVENT_NAMES.buildProgress, (event) => {
      const parsed = parseBuildProgress(event.data);
      if (parsed !== null) latest.current.onBuildProgress?.(parsed);
    });
    return () => source.close();
  }, [openEvents, generation]);

  const reconnect = useCallback(() => setGeneration((value) => value + 1), []);
  return { status, reconnect };
}
