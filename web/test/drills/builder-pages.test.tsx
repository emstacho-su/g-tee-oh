/**
 * The drill builder as one container with a page per section (S40, R3.14, O-405, screen review
 * rows 37 and 38): the bare and unknown builder URLs go to the first page, the "Drill sections"
 * list moves between pages with one draft kept across them, Save on any page saves every page, a
 * page holding errors is marked in the list and linked from the form alert, and a create opens the
 * new drill on the same page. The leave guard (PM note 3): a dirty draft asks before leaving the
 * builder (a router blocker and beforeunload); moving between pages of the same builder, a clean
 * draft and a saved draft never ask.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { BUILDER_SECTIONS, errorCountsBySection, sectionOfField } from "../../src/drills/builder-sections.js";
import { FIXTURE_DRILL_ID, fixtureDrill } from "../../src/fixtures/trainer.js";
import { renderDrills } from "./render-drills.js";

const UUID_PAGE = /^\/drills\/[0-9a-f-]{36}\/[a-z]+$/;
/** The builder walks many controls; under the parallel suite a test can pass the 5 s default. */
const PAGES_TEST_TIMEOUT_MS = 20_000;

function sections(): HTMLElement {
  return screen.getByRole("navigation", { name: "Drill sections" });
}

async function goTo(user: UserEvent, label: RegExp): Promise<void> {
  await user.click(within(sections()).getByRole("link", { name: label }));
}

async function newBuilder(): Promise<{ user: UserEvent; view: ReturnType<typeof renderDrills> }> {
  const view = renderDrills("/drills/new");
  await screen.findByRole("heading", { level: 1, name: "New drill" });
  return { user: userEvent.setup(), view };
}

function beforeUnloadBlocked(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("R3.14 sectionOfField places each error on its page (O-405)", () => {
  it.each([
    ["name", "details"],
    ["tags.2", "details"],
    ["body.spot_filter.game_config.depths_bb.1", "game"],
    ["spot_filter.stake", "game"],
    ["body.spot_filter.sizing.open_bb", "game"],
    ["spot_filter.hero_positions", "seats"],
    ["body.spot_filter.line", "seats"],
    ["spot_filter.hands.hands.4", "hands"],
    ["spot_filter.board.flops.0", "board"],
    ["trainer.tables", "trainer"],
    ["body.trainer.panels.streak_counter", "panels"],
    ["trainer.stop_rule", "panels"],
    ["body.extra", "details"],
    ["querystring.cursor", "details"],
  ] as const)("R3.14 %s shows on %s", (path, section) => {
    expect(sectionOfField(path)).toBe(section);
  });

  it("R3.14 errorCountsBySection adds the lines of each page", () => {
    expect(errorCountsBySection({ name: ["a"], "spot_filter.stake": ["b"], "spot_filter.sizing.open_bb": ["c", "d"] })).toEqual({ details: 1, game: 3 });
  });
});

describe("R3.14 the builder's pages (O-405)", { timeout: PAGES_TEST_TIMEOUT_MS }, () => {
  it("R3.14 /drills/new opens the first page and lists every section", async () => {
    const { view } = await newBuilder();
    await waitFor(() => expect(view.router.state.location.pathname).toBe("/drills/new/details"));
    expect(within(sections()).getAllByRole("link").map((link) => link.textContent)).toEqual(BUILDER_SECTIONS.map((section) => section.label));
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Table size")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save drill" })).toBeInTheDocument();
  });

  it("R3.14 an unknown section and a bare stored drill URL go to the first page", async () => {
    const unknown = renderDrills("/drills/new/nowhere");
    await waitFor(() => expect(unknown.router.state.location.pathname).toBe("/drills/new/details"));
    unknown.unmount();
    const stored = renderDrills(`/drills/${FIXTURE_DRILL_ID}`);
    await waitFor(() => expect(stored.router.state.location.pathname).toBe(`/drills/${FIXTURE_DRILL_ID}/details`));
    expect(await screen.findByLabelText("Name")).toHaveValue(fixtureDrill.name);
  });

  it("R3.14 moving between pages keeps the draft and never asks to leave", async () => {
    const { user, view } = await newBuilder();
    await user.type(screen.getByLabelText("Name"), "Kept across pages");
    await goTo(user, /^Game/);
    await waitFor(() => expect(view.router.state.location.pathname).toBe("/drills/new/game"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Table size")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    await goTo(user, /^Name and tags/);
    expect(screen.getByLabelText("Name")).toHaveValue("Kept across pages");
  });

  it("R3.14 Save with errors marks each page that holds one and links it from the alert", async () => {
    const { user, view } = await newBuilder();
    await user.click(screen.getByRole("button", { name: "Save drill" }));
    const alert = screen.getByTestId("form-alert");
    expect(within(alert).getByRole("link", { name: "Name and tags: 1 field to fix" })).toBeInTheDocument();
    const seatsLink = within(alert).getByRole("link", { name: "Seats: 1 field to fix" });
    expect(within(sections()).getByRole("link", { name: "Seats, needs a fix" })).toHaveTextContent("needs a fix");
    expect(within(sections()).getByRole("link", { name: "Game" })).toBeInTheDocument();
    await user.click(seatsLink);
    await waitFor(() => expect(view.router.state.location.pathname).toBe("/drills/new/seats"));
    expect(screen.getByRole("group", { name: "Hero positions" })).toHaveAccessibleDescription("Error: Choose at least one hero position.");
    await user.click(within(screen.getByRole("group", { name: "Hero positions" })).getByRole("checkbox", { name: "BTN" }));
    expect(within(sections()).getByRole("link", { name: "Seats" })).toBeInTheDocument();
  });

  it("R3.14 a create from a later page opens the new drill on the same page with Drill saved.", async () => {
    const { user, view } = await newBuilder();
    await user.type(screen.getByLabelText("Name"), "Saved from the seats page");
    await goTo(user, /^Seats/);
    await user.click(within(screen.getByRole("group", { name: "Hero positions" })).getByRole("checkbox", { name: "BTN" }));
    await user.click(screen.getByRole("button", { name: "Save drill" }));
    await waitFor(() => expect(view.router.state.location.pathname).toMatch(UUID_PAGE));
    expect(view.router.state.location.pathname.endsWith("/seats")).toBe(true);
    expect(await screen.findByTestId("builder-status")).toHaveTextContent("Drill saved.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(view.router.state.location.search).toEqual({}));
  });
});

describe("R3.14 the leave guard (PM note 3, O-405)", { timeout: PAGES_TEST_TIMEOUT_MS }, () => {
  async function leaveByNav(user: UserEvent): Promise<void> {
    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Drills" }));
  }

  it("R3.14 a dirty draft asks before leaving: Keep editing stays with the draft, Leave goes", async () => {
    const { user, view } = await newBuilder();
    await user.type(screen.getByLabelText("Name"), "Unsaved");
    await leaveByNav(user);
    const dialog = await screen.findByRole("dialog", { name: "Leave without saving?" });
    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(view.router.state.location.pathname).toBe("/drills/new/details");
    expect(screen.getByLabelText("Name")).toHaveValue("Unsaved");
    await leaveByNav(user);
    await user.click(within(await screen.findByRole("dialog", { name: "Leave without saving?" })).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(view.router.state.location.pathname).toBe("/drills"));
    expect(await screen.findByRole("heading", { level: 1, name: "Drill library" })).toBeInTheDocument();
  });

  it("R3.14 a clean draft leaves without asking", async () => {
    const { user, view } = await newBuilder();
    await leaveByNav(user);
    await waitFor(() => expect(view.router.state.location.pathname).toBe("/drills"));
    expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
  });

  it("R3.14 a saved draft is clean again: no prompt after Changes saved.", async () => {
    const user = userEvent.setup();
    const view = renderDrills(`/drills/${FIXTURE_DRILL_ID}/details`);
    const name = await screen.findByLabelText("Name");
    await user.type(name, "!");
    await user.click(screen.getByRole("button", { name: "Save drill" }));
    await waitFor(() => expect(screen.getByTestId("builder-status")).toHaveTextContent("Changes saved."));
    await leaveByNav(user);
    await waitFor(() => expect(view.router.state.location.pathname).toBe("/drills"));
  });

  it("R3.14 undoing an edit makes the draft clean, a panel toggled on and off included (review round 1, F)", async () => {
    const { user } = await newBuilder();
    await goTo(user, /^Panels/);
    const group = screen.getByRole("group", { name: "Panels shown after a decision" });
    const off = within(group)
      .getAllByRole("checkbox")
      .find((box) => !(box as HTMLInputElement).checked);
    if (off === undefined) throw new Error("every panel is on by default");
    await user.click(off);
    expect(beforeUnloadBlocked()).toBe(true);
    await user.click(off);
    expect(beforeUnloadBlocked()).toBe(false);
  });

  it("R3.14 signing out with unsaved edits is never blocked (security review L4)", async () => {
    const { user, view } = await newBuilder();
    await user.type(screen.getByLabelText("Name"), "Unsaved at sign-out");
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(view.router.state.location.pathname.startsWith("/drills/new")).toBe(false));
    expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
  });

  it("R3.14 an edit made while a create is in flight moves to the new drill as unsaved changes, and the next Save patches it (review round 1, B)", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const view = renderDrills("/drills/new", {
      override: async (request) => {
        if (request.method === "POST" && request.path === "/api/v1/drills") await held;
        return undefined;
      },
    });
    await screen.findByRole("heading", { level: 1, name: "New drill" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Name"), "Created while typing");
    await goTo(user, /^Seats/);
    await user.click(within(screen.getByRole("group", { name: "Hero positions" })).getByRole("checkbox", { name: "BTN" }));
    await user.click(screen.getByRole("button", { name: "Save drill" }));
    await goTo(user, /^Name and tags/);
    await user.type(screen.getByLabelText("Name"), " more");
    release();
    // The builder's own move to the new drill never asks, and the form is now the stored drill's.
    await waitFor(() => expect(view.router.state.location.pathname).toMatch(UUID_PAGE));
    expect(view.router.state.location.pathname.endsWith("/details")).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Name")).toHaveValue("Created while typing more");
    // The carried edit is unsaved: leaving asks, and the next Save is a PATCH of the new drill.
    await leaveByNav(user);
    await user.click(within(await screen.findByRole("dialog", { name: "Leave without saving?" })).getByRole("button", { name: "Keep editing" }));
    await user.click(screen.getByRole("button", { name: "Save drill" }));
    await waitFor(() => expect(view.requests.filter((request) => request.method === "PATCH")).toHaveLength(1));
    const patch = view.requests.find((request) => request.method === "PATCH");
    expect(patch?.path).toBe(view.router.state.location.pathname.replace(/^\/drills\//, "/api/v1/drills/").replace(/\/details$/, ""));
    expect(patch?.body).toEqual({ name: "Created while typing more" });
    expect(view.sent("POST", "/api/v1/drills")).toHaveLength(1);
  });

  it("R3.36 Save and run with an edit made while the create was in flight stays in the builder, keeps the edit and says to save again (PR #48 review MEDIUM 6)", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const view = renderDrills("/drills/new", {
      override: async (request) => {
        if (request.method === "POST" && request.path === "/api/v1/drills") await held;
        return undefined;
      },
    });
    await screen.findByRole("heading", { level: 1, name: "New drill" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Name"), "Run while typing");
    await goTo(user, /^Seats/);
    await user.click(within(screen.getByRole("group", { name: "Hero positions" })).getByRole("checkbox", { name: "BTN" }));
    await user.click(screen.getByRole("button", { name: "Save and run" }));
    await goTo(user, /^Name and tags/);
    await user.type(screen.getByLabelText("Name"), " more");
    release();
    await waitFor(() => expect(view.router.state.location.pathname).toMatch(UUID_PAGE));
    // No run screen and no session: the builder keeps the edit as an unsaved change and says why.
    expect(view.router.state.location.pathname.endsWith("/details")).toBe(true);
    expect(await screen.findByTestId("builder-status")).toHaveTextContent("Saved; you changed it since, save again to run.");
    expect(await screen.findByLabelText("Name")).toHaveValue("Run while typing more");
    expect(view.sent("POST", "/api/v1/sessions")).toHaveLength(0);
  });

  it("R3.36 Save and run on a stored drill edited while the patch was in flight stays and says to save again", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const view = renderDrills(`/drills/${FIXTURE_DRILL_ID}/details`, {
      override: async (request) => {
        if (request.method === "PATCH") await held;
        return undefined;
      },
    });
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Name");
    await user.type(name, " v2");
    await user.click(screen.getByRole("button", { name: "Save and run" }));
    await user.type(screen.getByLabelText("Name"), " v3");
    release();
    expect(await screen.findByTestId("builder-status")).toHaveTextContent("Saved; you changed it since, save again to run.");
    expect(view.router.state.location.pathname).toBe(`/drills/${FIXTURE_DRILL_ID}/details`);
    expect(view.sent("POST", "/api/v1/sessions")).toHaveLength(0);
  });

  it("R3.14 beforeunload is held only while the draft is dirty", async () => {
    const { user, view } = await newBuilder();
    expect(beforeUnloadBlocked()).toBe(false);
    await user.type(screen.getByLabelText("Name"), "x");
    expect(beforeUnloadBlocked()).toBe(true);
    await user.clear(screen.getByLabelText("Name"));
    expect(beforeUnloadBlocked()).toBe(false);
    act(() => view.unmount());
    expect(beforeUnloadBlocked()).toBe(false);
  });
});
