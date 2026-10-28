/**
 * /settings as one container with a page per section (S36, R4.12, O-348, O-360, O-361): the URL
 * names the section, a "Settings sections" list moves between them with aria-current on the
 * open one, each URL shows only its own page, /settings and unknown sections land on Session
 * defaults, and the builder schedule and the invites (S42) are listed for admins only (a member
 * opening the schedule's URL reads the admins-only note).
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { fixtureMemberSession } from "../../src/fixtures/index.js";
import { fixtureBuilderStatus } from "../../src/fixtures/library.js";
import { fixtureStreak } from "../../src/fixtures/progress.js";
import { defaultHotkeyStore } from "../../src/hotkeys/index.js";
import { jsonResponse, sessionResponse, type FetchScript } from "../api/fake-fetch.js";
import { renderApp } from "../app/render-app.js";

const member: FetchScript = {
  "GET /api/v1/me": [jsonResponse(200, fixtureMemberSession)],
  "GET /api/v1/progress/streak": [jsonResponse(200, fixtureStreak)],
};
const admin: FetchScript = {
  ...member,
  "GET /api/v1/me": [sessionResponse()],
  "GET /api/v1/admin/builder": [jsonResponse(200, fixtureBuilderStatus)],
};

const MEMBER_SECTIONS: readonly (readonly [string, string])[] = [
  ["Session defaults", "/settings/session-defaults"],
  ["Configuration scope", "/settings/configurations"],
  ["Hotkeys", "/settings/hotkeys"],
  ["Cosmetics", "/settings/cosmetics"],
];
const PAGE_REGIONS = ["Session defaults", "Configuration scope", "Hotkeys", "Cosmetics"];

beforeEach(() => {
  defaultHotkeyStore.getState().setOverlayOpen(false);
});

async function sectionNav() {
  return screen.findByRole("navigation", { name: "Settings sections" });
}

describe("R4.12 /settings container (O-348, O-360)", () => {
  it("R4.12 /settings opens Session defaults and the URL names it", async () => {
    const { router } = renderApp("/settings", member);

    expect(await screen.findByRole("region", { name: "Session defaults" })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/session-defaults"));
  });

  it("R4.12 an unknown section lands on Session defaults", async () => {
    const { router } = renderApp("/settings/not-a-section", member);

    expect(await screen.findByRole("region", { name: "Session defaults" })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/session-defaults"));
  });

  it("R4.12 a member's section list names every page but the builder schedule, with the open one current (O-361)", async () => {
    renderApp("/settings/hotkeys", member);

    const nav = await sectionNav();
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual(MEMBER_SECTIONS);
    expect(within(nav).getByRole("link", { name: "Hotkeys" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Cosmetics" })).not.toHaveAttribute("aria-current");
    for (const link of links) expect(link).toHaveClass("tactile");
  });

  it("R4.12 each URL shows only its own page", async () => {
    renderApp("/settings/cosmetics", member);

    expect(await screen.findByRole("region", { name: "Cosmetics" })).toBeInTheDocument();
    for (const other of PAGE_REGIONS.filter((name) => name !== "Cosmetics")) {
      expect(screen.queryByRole("region", { name: other })).toBeNull();
    }
  });

  it("R4.12 choosing a section moves the URL and the page", async () => {
    const user = userEvent.setup();
    const { router } = renderApp("/settings/session-defaults", member);

    const nav = await sectionNav();
    await user.click(within(nav).getByRole("link", { name: "Configuration scope" }));
    const scope = await screen.findByRole("region", { name: "Configuration scope" });
    expect(router.state.location.pathname).toBe("/settings/configurations");
    expect(within(scope).getByRole("group", { name: "Configurations" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Session defaults" })).toBeNull();
    expect(within(nav).getByRole("link", { name: "Configuration scope" })).toHaveAttribute("aria-current", "page");
  });

  it("R4.12 Session defaults keeps grouping and the RNG switch; the scope lives on its own page", async () => {
    renderApp("/settings/session-defaults", member);

    const defaults = await screen.findByRole("region", { name: "Session defaults" });
    expect(within(defaults).getByLabelText("Grouping")).toBeInTheDocument();
    expect(within(defaults).getByRole("radio", { name: "Simple" })).toBeInTheDocument();
    expect(within(defaults).getByRole("checkbox")).toBeInTheDocument();
    expect(within(defaults).queryByRole("group", { name: "Configurations" })).toBeNull();
  });

  it("R3.5 a member opening the builder schedule URL reads that it is for admins (O-361)", async () => {
    renderApp("/settings/builder-schedule", member);

    expect(await screen.findByText("The builder schedule is for admins.")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Builder schedule" })).toBeNull();
  });

  it("R3.5 an admin's section list ends with the builder schedule and the invites (S42), and the schedule page holds the form", async () => {
    const user = userEvent.setup();
    renderApp("/settings/session-defaults", admin);

    const nav = await sectionNav();
    const link = await within(nav).findByRole("link", { name: "Builder schedule" });
    expect(link).toHaveAttribute("href", "/settings/builder-schedule");
    const links = within(nav).getAllByRole("link");
    expect(links.at(-2)).toBe(link);
    expect(links.at(-1)).toHaveAttribute("href", "/settings/invites");
    expect(links.at(-1)).toHaveTextContent("Invites");
    await user.click(link);
    expect(await screen.findByRole("form", { name: "Builder schedule" })).toBeInTheDocument();
  });
});
