/**
 * Home shell tests (R3.13, A7 section 2, O-266). The authenticated layout shows the header (app
 * name, signed-in email, theme toggle, sign out), the "Main" navigation with aria-current on the
 * active link, and the shortcuts hint; the home page shows its four cards. Sign out
 * sends the CSRF (cross-site request forgery) token, forgets it and lands on /login.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { fixtureMemberSession, fixtureSession } from "../../src/fixtures/index.js";
import { fixtureBuilderStatus } from "../../src/fixtures/library.js";
import { defaultHotkeyStore } from "../../src/hotkeys/index.js";
import { HEADER_LAYER_CLASS } from "../../src/components/ui/index.js";
import { useThemeStore } from "../../src/store/index.js";
import { jsonResponse, noContent, problemResponse, sessionResponse } from "../api/fake-fetch.js";
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
  // The app-wide hotkey store outlives a test; an overlay left open would hide the page from queries.
  defaultHotkeyStore.getState().setOverlayOpen(false);
});

describe("home shell", () => {
  it("R3.13 the header, the Main navigation and the main region are top-level landmarks inside the shell", async () => {
    renderApp("/", SIGNED_IN);

    const shell = await screen.findByTestId("shell");
    const banner = await screen.findByRole("banner");
    const main = screen.getByRole("main");
    expect(shell.contains(banner)).toBe(true);
    expect(main.contains(banner)).toBe(false);
    expect(within(main).getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("R3.13 ? opens the keyboard shortcuts overlay on a signed-in screen", async () => {
    const user = userEvent.setup();
    renderApp("/", SIGNED_IN);

    await screen.findByRole("navigation", { name: "Main" });
    await user.keyboard("?");
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });

  it("R3.13 the header shows the app name, the signed-in email and the shortcuts hint", async () => {
    renderApp("/", SIGNED_IN);

    const header = await screen.findByTestId("app-header");
    expect(within(header).getByText("g-tee-oh")).toBeInTheDocument();
    expect(await within(header).findByText(fixtureSession.user.email)).toBeInTheDocument();
    expect(screen.getByText(/Press \? for shortcuts/)).toBeInTheDocument();
  });

  it("R3.13 at phone width the header keeps the app name and buttons on one line and shortens the email", async () => {
    renderApp("/", SIGNED_IN);

    const header = await screen.findByTestId("app-header");
    expect(within(header).getByText("g-tee-oh")).toHaveClass("whitespace-nowrap");
    const email = await within(header).findByText(fixtureSession.user.email);
    expect(email).toHaveClass("truncate");
    expect(email).toHaveAttribute("title", fixtureSession.user.email);
    expect(within(header).getByRole("button", { name: "Sign out" })).toHaveClass("whitespace-nowrap");
    for (const button of within(header).getAllByRole("button")) expect(button).toHaveClass("whitespace-nowrap");
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

  it("R3.13 the Main navigation is one scrolling row at phone width and a column from md, with tactile links (O-346)", async () => {
    renderApp("/study", SIGNED_IN);

    const nav = await screen.findByRole("navigation", { name: "Main" });
    const list = within(nav).getByRole("list");
    expect(list).toHaveClass("flex-nowrap", "overflow-x-auto", "md:flex-col");
    for (const link of within(nav).getAllByRole("link")) expect(link).toHaveClass("tactile", "whitespace-nowrap");
    // The active link is bold as well as highlighted, so colour is never the only signal.
    expect(within(nav).getByRole("link", { name: "Study" })).toHaveClass("font-semibold");
  });

  it("R3.13 the sticky header sits on the header layer, below dialogs (S36 review)", async () => {
    renderApp("/", SIGNED_IN);
    expect(await screen.findByTestId("app-header")).toHaveClass(HEADER_LAYER_CLASS, "sticky");
  });

  it("R3.13 from md the sticky nav is capped at the viewport and scrolls, so every link stays reachable (S36 review)", async () => {
    renderApp("/", SIGNED_IN);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(nav).toHaveClass("md:sticky", "md:overflow-y-auto");
    expect(nav.className).toMatch(/md:max-h-\[calc\(100dvh-/);
  });

  it("R4.12 every home grid item can shrink below its content width (min-w-0), so 390 px never scrolls sideways", async () => {
    renderApp("/", SIGNED_IN);
    const grid = await screen.findByTestId("home-grid");
    for (const item of Array.from(grid.children)) expect(item).toHaveClass("min-w-0");
  });

  it("R3.13 the Settings link stays active on every settings page (O-360)", async () => {
    renderApp("/settings/hotkeys", SIGNED_IN);

    const nav = await screen.findByRole("navigation", { name: "Main" });
    await waitFor(() => expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page"));
  });

  it("R3.13 the header's buttons take the shared tactile press", async () => {
    renderApp("/", SIGNED_IN);

    const header = await screen.findByTestId("app-header");
    for (const button of within(header).getAllByRole("button")) expect(button).toHaveClass("tactile");
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

  it("R3.13 R4.12 the home page shows four cards: today's queue, streak, rating and builder status", async () => {
    renderApp("/", SIGNED_IN);

    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    for (const title of ["Today's queue", "Streak", "Rating", "Builder status"]) {
      expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
    }
    // This script answers no progress read, so each progress card ends in its error state.
    for (const title of ["Today's queue", "Streak", "Rating"]) {
      const card = screen.getByRole("region", { name: title });
      expect(await within(card).findByRole("button", { name: /^Try again/ })).toBeInTheDocument();
    }
  });

  it("R3.5 the home builder status card shows an admin the builder state and links to /library (O-290)", async () => {
    renderApp("/", {
      ...SIGNED_IN,
      "GET /api/v1/admin/builder": [jsonResponse(200, fixtureBuilderStatus)],
    });

    const card = await screen.findByRole("region", { name: "Builder status" });
    await waitFor(() => expect(card).toHaveTextContent("Builder state: Running. 3 builds queued."));
    expect(within(card).getByRole("link", { name: "Open the library" })).toHaveAttribute("href", "/library");
  });

  it("R3.5 the home builder status card never asks a member's builder status (O-290)", async () => {
    const { fake } = renderApp("/", { "GET /api/v1/me": [jsonResponse(200, fixtureMemberSession)] });

    const card = await screen.findByRole("region", { name: "Builder status" });
    expect(card).toHaveTextContent("Background library builder health is on the Library screen.");
    expect(fake.keys()).not.toContain("GET /api/v1/admin/builder");
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
