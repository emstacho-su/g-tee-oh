/**
 * Home shell tests (R3.13, A7 section 2, O-266). The authenticated layout shows the header (app
 * name, signed-in email, theme toggle, sign out), the "Main" navigation with aria-current on the
 * active link, and the shortcuts hint; the home page shows its four placeholder cards. Sign out
 * sends the CSRF (cross-site request forgery) token, forgets it and lands on /login.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { fixtureSession } from "../../src/fixtures/index.js";
import { useThemeStore } from "../../src/store/index.js";
import { noContent, problemResponse, sessionResponse } from "../api/fake-fetch.js";
import { renderApp, SIGNED_IN } from "./render-app.js";

const NAV_LINKS: readonly (readonly [string, string])[] = [
  ["Home", "/"],
  ["Train", "/train"],
  ["Drills", "/drills"],
  ["New drill", "/drills/new"],
  ["Study", "/study"],
  ["Predict", "/predict"],
  ["Paint", "/paint"],
  ["Progress", "/progress"],
  ["Library", "/library"],
  ["Settings", "/settings"],
];

beforeEach(() => {
  useThemeStore.getState().setTheme("light");
});

describe("home shell", () => {
  it("R3.13 the header shows the app name, the signed-in email and the shortcuts hint", async () => {
    renderApp("/", SIGNED_IN);

    // The header sits inside <main data-testid="shell"> (kept for R0.7), so it is not a banner landmark.
    const header = await screen.findByTestId("app-header");
    expect(within(header).getByText("g-tee-oh")).toBeInTheDocument();
    expect(await within(header).findByText(fixtureSession.user.email)).toBeInTheDocument();
    expect(screen.getByText(/Press \? for shortcuts/)).toBeInTheDocument();
  });

  it("R3.13 the Main navigation links every app route and marks the active one", async () => {
    renderApp("/study", SIGNED_IN);

    const nav = await screen.findByRole("navigation", { name: "Main" });
    for (const [name, href] of NAV_LINKS) {
      expect(within(nav).getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(within(nav).getByRole("link", { name: "Study" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("R3.13 clicking a nav link moves aria-current", async () => {
    const user = userEvent.setup();
    const { router } = renderApp("/", SIGNED_IN);

    const nav = await screen.findByRole("navigation", { name: "Main" });
    await user.click(within(nav).getByRole("link", { name: "Progress" }));

    await screen.findByRole("heading", { level: 1, name: "Progress" });
    expect(router.state.location.pathname).toBe("/progress");
    expect(within(nav).getByRole("link", { name: "Progress" })).toHaveAttribute("aria-current", "page");
  });

  it("R3.13 the theme toggle switches the dark class and its own name", async () => {
    const user = userEvent.setup();
    renderApp("/", SIGNED_IN);

    await user.click(await screen.findByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("R3.13 the home page shows four cards naming the session that fills each", async () => {
    renderApp("/", SIGNED_IN);

    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    const cards: readonly (readonly [string, string])[] = [
      ["Today's queue", "Phase 4 (S32)"],
      ["Streak", "S32"],
      ["Rating", "S32"],
      ["Builder status", "S28"],
    ];
    for (const [title, session] of cards) {
      const card = screen.getByRole("region", { name: title });
      expect(card).toHaveTextContent(`Filled in ${session}`);
    }
  });

  it("R3.13 Sign out sends the token, forgets it and lands on /login", async () => {
    const user = userEvent.setup();
    const { fake, api, router } = renderApp("/", {
      "GET /api/v1/me": [sessionResponse("live-token"), problemResponse(401, "unauthenticated")],
      "POST /api/v1/auth/logout": [noContent()],
    });

    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    expect(router.state.location.pathname).toBe("/login");
    const logout = fake.calls.find((call) => call.path === "/api/v1/auth/logout");
    expect(logout?.csrf).toBe("live-token");
    expect(api.tokens.get()).toBeNull();
  });

  it("R3.13 Sign out still clears the local session when the server call fails", async () => {
    const user = userEvent.setup();
    const { api, router } = renderApp("/", {
      "GET /api/v1/me": [sessionResponse("live-token")],
      "POST /api/v1/auth/logout": [problemResponse(500, "internal")],
    });

    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(api.tokens.get()).toBeNull();
  });
});
