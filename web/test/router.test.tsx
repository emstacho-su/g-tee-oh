/**
 * Router tests for the web app (R0.7, R3.13). They run under vitest with the jsdom environment
 * configured in vite.config.ts and render the real route tree through a memory history and an
 * injected fake fetch, so no browser and no server are involved. The Playwright smoke flow in
 * e2e/ covers the served build through Caddy; vitest never sees that file.
 *
 * S24 extends the S06 checks to every A7 section 2 route: the authenticated layout sends a
 * signed-out visitor to /login with the current path as the redirect, and /login sends a
 * signed-in user to the safe redirect target.
 */
import { createMemoryHistory } from "@tanstack/react-router";
import { act, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ApiProblem, createAppApi } from "../src/api/index.js";
import { createQueryClient } from "../src/auth/index.js";
import { createAppRouter } from "../src/router.js";
import { problemResponse, sessionResponse } from "./api/fake-fetch.js";
import { renderApp, SIGNED_IN, SIGNED_OUT, TEST_ORIGIN } from "./app/render-app.js";

const EXPECTED_PATHS = [
  "/",
  "/login",
  "/train",
  "/drills",
  "/drills/new",
  "/drills/$id",
  "/drills/$id/run",
  "/study",
  "/quiz",
  "/predict",
  "/paint",
  "/progress",
  "/library",
  "/settings",
] as const;

describe("@g-tee-oh/web router", () => {
  it("R0.7 the route tree carries every A7 section 2 route", () => {
    const router = createAppRouter({
      queryClient: createQueryClient(),
      api: createAppApi({ baseUrl: TEST_ORIGIN, fetch: () => Promise.reject(new Error("no fetch")) }),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    const registeredPaths = Object.keys(router.routesByPath);

    for (const path of EXPECTED_PATHS) {
      expect(registeredPaths).toContain(path);
    }
  });

  it("R0.7 /login renders the sign-in page inside the shell", async () => {
    renderApp("/login", SIGNED_OUT);

    const heading = await screen.findByRole("heading", { level: 1, name: "Sign in" });
    const shell = screen.getByTestId("shell");

    expect(shell.contains(heading)).toBe(true);
  });

  it("R3.13 a signed-out visit to an app route redirects to /login with the path as redirect", async () => {
    const { router } = renderApp("/drills/abc/run?x=1", SIGNED_OUT);

    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ redirect: "/drills/abc/run?x=1" });
  });

  it("R3.13 /login sends a signed-in user to the safe redirect target", async () => {
    const { router } = renderApp("/login?redirect=%2Fstudy", SIGNED_IN);

    await screen.findByRole("heading", { level: 1, name: "Solution browser" });
    expect(router.state.location.pathname).toBe("/study");
  });

  it("R3.13 /login sends a signed-in user home when the redirect is unsafe", async () => {
    const { router } = renderApp("/login?redirect=%2F%2Fevil.example", SIGNED_IN);

    await screen.findByRole("heading", { level: 1, name: "Home" });
    expect(router.state.location.pathname).toBe("/");
  });

  it("R3.13 /login still renders when /me fails with a server error", async () => {
    renderApp("/login", { "GET /api/v1/me": [problemResponse(500, "internal")] });

    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
  });

  it("R3.13 an app route shows an error with a retry when /me fails with a server error", async () => {
    const { fake } = renderApp("/study", { "GET /api/v1/me": [problemResponse(500, "internal")] });

    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent("Could not load your session.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(fake.calls.length).toBeGreaterThan(0);
  });

  it("R3.13 Try again reloads the session and shows the route once /me answers", async () => {
    const user = userEvent.setup();
    renderApp("/study", { "GET /api/v1/me": [problemResponse(500, "internal"), sessionResponse()] });

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Solution browser" })).toBeInTheDocument();
  });

  it("R3.13 a later 401 anywhere sends the user to /login with the current path", async () => {
    const { router, queryClient } = renderApp("/progress", SIGNED_IN);
    await screen.findByRole("heading", { level: 1, name: "Progress" });

    await act(async () => {
      await queryClient
        .fetchQuery({
          queryKey: ["any"],
          queryFn: () => Promise.reject(new ApiProblem({ status: 401, slug: "unauthenticated", title: "t" })),
        })
        .catch(() => undefined);
    });

    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    expect(router.state.location.search).toEqual({ redirect: "/progress" });
  });

  it("R3.16 /predict redirects to /quiz, keeping drill and seed and dropping unknown parameters (O-419)", async () => {
    const drill = "00000000-0000-4000-8000-000000000005";
    const { router } = renderApp(`/predict?drill=${drill}&seed=00000000deadbeef&tab=old`, {
      ...SIGNED_IN,
      "POST /api/v1/sessions": [() => new Promise<Response>(() => undefined)],
    });

    await screen.findByRole("heading", { level: 1, name: "Quizzes" });
    expect(router.state.location.pathname).toBe("/quiz");
    expect(router.state.location.search).toEqual({ drill, seed: "00000000deadbeef" });
  });

  it("R3.16 a bare /predict lands on the /quiz start screen", async () => {
    const { router } = renderApp("/predict", SIGNED_IN);

    await screen.findByRole("heading", { level: 1, name: "Quizzes" });
    expect(router.state.location.pathname).toBe("/quiz");
    expect(router.state.location.search).toEqual({});
  });
});
