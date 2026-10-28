/**
 * The motion preference a screen test renders under (S38, R3.13, O-381). The run and train
 * harnesses render with prefers-reduced-motion on by default, so the opponent-action replay shows
 * its end state at once and a test that is not about the replay is never held up by it; the
 * replay's own screen tests ask for motion. Every other query keeps test/setup.ts's inert answer
 * (matches false). Vitest isolates each test file, so the stub never leaks into another file, and
 * each harness call sets it again.
 */
import { REDUCED_MOTION_QUERY } from "../../src/components/table/index.js";

function mediaList(query: string, matches: boolean): MediaQueryList {
  return {
    matches,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  };
}

/** Makes prefers-reduced-motion match (true) or not (false) for the screens rendered next. */
export function setReducedMotion(reduce: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => mediaList(query, reduce && query === REDUCED_MOTION_QUERY),
  });
}
