/**
 * Vitest setup for the web suite (S24). jest-dom adds DOM matchers (toBeInTheDocument,
 * toHaveAccessibleName and the rest) to expect; cleanup unmounts every rendered tree after each
 * test so one test's DOM never leaks into the next. jsdom has no scrollTo and no matchMedia,
 * and the router and the theme code call them, so both get inert stubs here.
 */
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(cleanup);

// A test file may opt into the node environment ("// @vitest-environment node"); it has no window.
const hasWindow = typeof window !== "undefined";

if (hasWindow) vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

if (hasWindow && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
