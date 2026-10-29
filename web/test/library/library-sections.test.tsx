/**
 * /library as one container with a page per section (S40, R3.4, R3.5, O-406, screen review rows 63
 * to 70): the bare URL and an unknown section land on Coverage with the search kept; the section
 * list shows Coverage to a member and all three pages to an admin; a member opening an admin page
 * reads the admin note and gets no control and no admin read (O-290, O-361); the section links
 * carry the coverage search, so a selected pair survives a page change; and the coverage page
 * shows its four cards.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FIXTURE_QUEUE_PAIR } from "../../src/fixtures/library.js";
import { FIXTURE_ONLINE_STAKE_ID } from "../../src/fixtures/study.js";
import { libraryPath, renderLibrary } from "./render-library.js";

const BUILDER_PATH = "/api/v1/admin/builder";
const SEARCH = `format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000&pair=${FIXTURE_QUEUE_PAIR}`;
const MEMBER_NOTE = "Builder health and controls are for admins.";

function sectionNav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Library sections" });
}

describe("R3.4 R3.5 the library sections (O-406)", () => {
  it("R3.4 /library redirects to the coverage page and keeps the search", async () => {
    const { router } = renderLibrary(`/library?${SEARCH}`);
    await screen.findByRole("list", { name: "Pairs" });
    expect(router.state.location.pathname).toBe("/library/coverage");
    expect(router.state.location.search).toMatchObject({ pair: FIXTURE_QUEUE_PAIR, depth: "10000" });
  });

  it("R3.4 an unknown section redirects to the coverage page and keeps the search", async () => {
    const { router } = renderLibrary(`/library/queue?${SEARCH}`);
    await screen.findByRole("list", { name: "Pairs" });
    expect(router.state.location.pathname).toBe("/library/coverage");
    expect(router.state.location.search).toMatchObject({ pair: FIXTURE_QUEUE_PAIR });
  });

  it("R3.4 the page opens under one h1 with the live updates line, and Main marks Library on every section page", async () => {
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "builder"));
    expect(await screen.findByRole("heading", { level: 1, name: "Library" })).toBeInTheDocument();
    expect(screen.getByTestId("live-status")).toBeInTheDocument();
    const main = screen.getByRole("navigation", { name: "Main" });
    expect(within(main).getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
  });

  it("R3.4 R3.5 the catalog and the coverage stream belong to the coverage page: the settings page reads neither (review round 1, H)", async () => {
    const { requests, streams } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_QUEUE_PAIR, "settings"));
    await screen.findByRole("heading", { name: "Builder settings" });
    await waitFor(() => expect(requests.some((request) => request.path === BUILDER_PATH)).toBe(true));
    expect(requests.filter((request) => /^\/api\/v1\/(stakes|configs)/.test(request.path))).toEqual([]);
    expect(streams).toHaveLength(0);
  });

  it("R3.5 a member's section list shows Coverage only; an admin's shows all three pages", async () => {
    const member = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID), { admin: false });
    await screen.findByRole("list", { name: "Pairs" });
    expect(within(sectionNav()).getAllByRole("link").map((link) => link.textContent)).toEqual(["Coverage"]);
    member.unmount();

    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID));
    await screen.findByRole("list", { name: "Pairs" });
    await waitFor(() =>
      expect(within(sectionNav()).getAllByRole("link").map((link) => link.textContent)).toEqual(["Coverage", "Builder state", "Builder settings"]),
    );
  });

  it.each(["builder", "settings"] as const)("R3.5 a member at /library/%s reads the admin note, with no control and no admin read (O-290)", async (section) => {
    const { sent } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, section), { admin: false });
    expect(await screen.findByText(MEMBER_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /the builder$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save builder settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(sent("GET", BUILDER_PATH)).toEqual([]);
  });

  it("R3.4 the section links carry the coverage search, so the selected pair survives a page change", async () => {
    const user = userEvent.setup();
    const { router } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_QUEUE_PAIR));
    await screen.findByRole("table", { name: "Build queue for this pair" });
    const builderLink = await within(sectionNav()).findByRole("link", { name: "Builder state" });
    expect(builderLink.getAttribute("href")).toContain(`pair=${FIXTURE_QUEUE_PAIR}`);

    await user.click(builderLink);
    await screen.findByTestId("builder-state");
    expect(router.state.location.pathname).toBe("/library/builder");
    await user.click(within(sectionNav()).getByRole("link", { name: "Coverage" }));

    expect(await screen.findByRole("button", { name: /^Big blind versus button/ })).toHaveAttribute("aria-pressed", "true");
    expect(router.state.location.search).toMatchObject({ pair: FIXTURE_QUEUE_PAIR });
  });

  it("R3.4 the coverage page shows its four cards: configuration, coverage, flops and queue, request a gap", async () => {
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_QUEUE_PAIR));
    await screen.findByRole("table", { name: "Build queue for this pair" });
    for (const name of ["Configuration", "Coverage", "Flops and queue", "Request a gap"]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
    expect(within(screen.getByRole("region", { name: "Coverage" })).getByRole("list", { name: "Pairs" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Request a gap" })).getByRole("button", { name: "Request this flop" })).toBeInTheDocument();
  });

  it("R3.4 with no pair chosen the coverage card asks for one and the pair cards are absent", async () => {
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID));
    await screen.findByRole("list", { name: "Pairs" });
    expect(screen.getByText("Choose a pair to see its flops and queue, or to request it.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Flops and queue" })).not.toBeInTheDocument();
  });

  it("R3.5 the admin pages: Builder state is its own card, and Builder settings links to the overnight schedule", async () => {
    const user = userEvent.setup();
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "builder"));
    const state = await screen.findByRole("region", { name: "Builder state" });
    expect(within(state).getByRole("button", { name: "Pause the builder" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save builder settings" })).not.toBeInTheDocument();

    await user.click(within(sectionNav()).getByRole("link", { name: "Builder settings" }));
    expect(await screen.findByRole("button", { name: "Save builder settings" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set the overnight window in Settings" })).toHaveAttribute("href", "/settings/builder-schedule");
    expect(screen.queryByRole("region", { name: "Builder state" })).not.toBeInTheDocument();
  });
});
