/**
 * Router tests for the web skeleton (R0.7). They run under vitest with the jsdom environment
 * configured in vite.config.ts and render the real route tree through a memory history, so
 * no browser and no server are involved. The Playwright smoke flow in e2e/ covers the served
 * build through Caddy; vitest never sees that file.
 */
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createAppRouter } from "../src/router.js";

const EXPECTED_PATHS = ["/", "/login"] as const;

beforeAll(() => {
  // jsdom does not implement scrollTo and the router calls it on navigation; a stub keeps the
  // "Not implemented" message out of the suite output.
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(cleanup);

describe("@g-tee-oh/web router", () => {
  it("R0.7 the route tree carries / and /login", () => {
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
    const registeredPaths = Object.keys(router.routesByPath);

    for (const path of EXPECTED_PATHS) {
      expect(registeredPaths).toContain(path);
    }
  });

  it("R0.7 /login renders the sign-in placeholder inside the shell", async () => {
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/login"] }));
    render(<RouterProvider router={router} />);

    const heading = await screen.findByRole("heading", { level: 1, name: "Sign in" });
    const shell = screen.getByTestId("shell");

    expect(shell.contains(heading)).toBe(true);
  });
});
