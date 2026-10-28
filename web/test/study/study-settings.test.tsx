// Tests for the /study settings panel on the rendered screen (S39, R3.12, O-354, O-390, O-392):
// nothing is read or shown before Confirm, unavailable choices stay visible with their reason,
// Confirm writes the URL and opens the node, a complete link opens the solution directly, an
// uncovered link opens the panel with the reason, and a failed catalog read offers a retry.
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FIXTURE_DEEP_CONFIG_ID,
  FIXTURE_ONLINE_STAKE_ID,
  FIXTURE_STUDY_CONFIG_ID,
  fixturePairsByConfig,
} from "../../src/fixtures/study.js";
import { validateStudySearch } from "../../src/study/search.js";
import { problemOf, renderStudy } from "./render-study.js";

const NODE_SWITCH_LINE = /^g-tee-oh node-switch \d+\.\d ms root$/;
const ONLINE_100 = `format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000`;
const SUMMARY = "Online, 6 players, online (5% rake, cap $1.50), 100bb, BTN against BB";

// Only this file's spies are restored: restoring all would undo setup.ts's scrollTo stub.
let spies: { mockRestore: () => void }[] = [];

beforeEach(() => {
  // jsdom has no 2D canvas; the matrix then skips drawing and keeps its table (S24).
  spies = [vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)];
});

afterEach(() => {
  spies.forEach((spy) => spy.mockRestore());
});

/** A settings field: Radix renders a single-choice toggle group as a radiogroup. */
function field(name: string): HTMLElement {
  return screen.getByRole("radiogroup", { name });
}

function choice(fieldName: string, name: RegExp | string): HTMLElement {
  return within(field(fieldName)).getByRole("radio", { name });
}

async function chooseOnline100(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole("radio", { name: "Online" }));
  await user.click(await waitFor(() => choice("Table size", "6 players")));
  await user.click(await waitFor(() => choice("Stake", /^online/)));
  await user.click(await waitFor(() => choice("Depth", "100bb")));
}

describe("R3.12 study settings panel", () => {
  it("R3.12 with no settings the panel asks for them, the lower fields wait and no node is read", async () => {
    const { nodeRequests } = renderStudy("/study");
    expect(await screen.findByRole("heading", { level: 1, name: "Solution browser" })).toBeInTheDocument();
    const panel = screen.getByRole("region", { name: "Spot settings" });
    expect(within(panel).getByText("Choose the settings, then Confirm.")).toBeInTheDocument();
    expect(within(panel).getByText("Choose a format first.")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Confirm" })).toBeDisabled();
    expect(nodeRequests()).toEqual([]);
    expect(screen.queryByRole("img", { name: /range matrix/i })).not.toBeInTheDocument();
  });

  it("R3.12 the choices resolve the spot; nothing shows until Confirm, which writes the URL and opens the node", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    spies.push(info);
    const user = userEvent.setup();
    const { router, nodeRequests } = renderStudy("/study");

    await chooseOnline100(user);
    expect(choice("Stake", /^online/)).toHaveAccessibleName(/5% rake, cap \$1\.50/);
    await user.click(await waitFor(() => choice("First to act", /^BTN/)));
    await user.click(await waitFor(() => choice("Against", /^BB/)));
    expect(nodeRequests()).toEqual([]);
    expect(screen.queryByRole("img", { name: /range matrix/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("img", { name: /frequency mode/ })).toBeInTheDocument();
    // The URL holds strings (search-serialization.ts); the validator turns the numeric settings back.
    expect(validateStudySearch(router.state.location.search)).toEqual({
      format: "online",
      table_size: 6,
      stake: FIXTURE_ONLINE_STAKE_ID,
      depth: 10000,
      pair: "BB-BTN",
    });
    expect(nodeRequests()[0]?.query).toEqual({ config_id: FIXTURE_STUDY_CONFIG_ID, pair: "BB-BTN" });
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    await waitFor(() => expect(info).toHaveBeenCalledOnce());
    expect(info.mock.calls[0]?.[0]).toMatch(NODE_SWITCH_LINE);
  });

  it("R3.12 unavailable choices stay visible and focusable, announce their reason and cannot be chosen", async () => {
    const user = userEvent.setup();
    renderStudy("/study?format=live");
    const six = await waitFor(() => choice("Table size", /^6 players/));
    expect(six).toHaveAttribute("aria-disabled", "true");
    expect(six).not.toBeDisabled();
    expect(six).toHaveAccessibleName(/No live game at this size/);
    await user.click(six);
    expect(six).toHaveAttribute("aria-checked", "false");

    await user.click(choice("Table size", "9 players"));
    const twoFive = await waitFor(() => choice("Stake", /^2\/5/));
    expect(twoFive).toHaveAttribute("aria-disabled", "true");
    expect(twoFive).toHaveAccessibleName(/No 9-player game at this stake/);
    twoFive.focus();
    expect(twoFive).toHaveFocus();
  });

  it("R3.12 a seat without a covered pair is disabled as not in the library", async () => {
    renderStudy(`/study?${ONLINE_100}`);
    const co = await waitFor(() => choice("First to act", /^CO/));
    expect(co).toHaveAttribute("aria-disabled", "true");
    expect(co).toHaveAccessibleName(/Not in the library/);
    expect(choice("First to act", /^BTN/)).not.toHaveAttribute("aria-disabled");
  });

  it("R3.12 a complete link opens the solution directly with the settings summarized", async () => {
    const { nodeRequests } = renderStudy(`/study?${ONLINE_100}&pair=BB-BTN`);
    expect(await screen.findByRole("img", { name: /frequency mode/ })).toBeInTheDocument();
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(nodeRequests()).toHaveLength(2);
  });

  it("R3.12 a complete but uncovered link opens the panel with the reason and reads no node", async () => {
    const { nodeRequests } = renderStudy(`/study?${ONLINE_100}&pair=CO-BTN`);
    const panel = await screen.findByRole("region", { name: "Spot settings" });
    expect(await within(panel).findByText("CO-BTN is not in the library at this configuration.")).toBeInTheDocument();
    const btn = await waitFor(() => choice("Against", /^BTN/));
    expect(btn).toHaveAttribute("aria-checked", "true");
    expect(btn).toHaveAccessibleName(/Not in the library/);
    expect(within(panel).getByRole("button", { name: "Confirm" })).toBeDisabled();
    expect(nodeRequests()).toEqual([]);
    expect(screen.queryByRole("img", { name: /range matrix/i })).not.toBeInTheDocument();
  });

  it("R3.12 Change settings reopens the panel from the URL; a new depth clears the line and hand and keeps the mode", async () => {
    const user = userEvent.setup();
    const { router } = renderStudy(`/study?${ONLINE_100}&pair=BB-BTN&line=r250&hand=AKs&mode=ev`);
    await user.click(await screen.findByRole("button", { name: "Change settings" }));
    expect(choice("Table size", "6 players")).toHaveAttribute("aria-checked", "true");
    expect(choice("Against", /^BB/)).toHaveAttribute("aria-checked", "true");

    await user.click(choice("Depth", "200bb"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(validateStudySearch(router.state.location.search)).toEqual({
        format: "online",
        table_size: 6,
        stake: FIXTURE_ONLINE_STAKE_ID,
        depth: 20000,
        pair: "BB-BTN",
        mode: "ev",
      }),
    );
    expect(await screen.findByText("Online, 6 players, online (5% rake, cap $1.50), 200bb, BTN against BB")).toBeInTheDocument();
  });

  it("R3.12 Cancel closes the panel and leaves the URL as it was", async () => {
    const user = userEvent.setup();
    const path = `/study?${ONLINE_100}&pair=BB-BTN&line=r250`;
    const { router } = renderStudy(path);
    await user.click(await screen.findByRole("button", { name: "Change settings" }));
    await user.click(choice("Depth", "200bb"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    expect(validateStudySearch(router.state.location.search)).toMatchObject({ depth: 10000, line: "r250" });
  });

  it("R3.12 the disabled Confirm says why, and the uncovered notice follows the draft", async () => {
    const user = userEvent.setup();
    renderStudy(`/study?${ONLINE_100}&pair=CO-BTN`);
    const panel = await screen.findByRole("region", { name: "Spot settings" });
    expect(await within(panel).findByText("First to act: CO is unavailable (not in the library).")).toBeInTheDocument();
    expect(within(panel).getByText("CO-BTN is not in the library at this configuration.")).toBeInTheDocument();

    await user.click(choice("First to act", /^BTN/));
    await user.click(choice("Against", /^BB/));
    expect(within(panel).queryByText(/is not in the library at this configuration/)).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("R3.12 the panel stays mounted, focus kept, while a new configuration's seats load", async () => {
    const user = userEvent.setup();
    let release: (response: Response) => void = () => undefined;
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const stale = `/study?format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=30000&pair=BB-BTN`;
    renderStudy(stale, (request) => (request.path === `/api/v1/configs/${FIXTURE_STUDY_CONFIG_ID}/pairs` ? held : undefined));
    const panel = await screen.findByRole("region", { name: "Spot settings" });
    const depth = await waitFor(() => choice("Depth", "100bb"));
    await user.click(depth);
    expect(await within(panel).findByText("Loading the seats for these settings.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Spot settings" })).toBe(panel);
    expect(choice("Depth", "100bb")).toHaveFocus();

    release(
      new Response(JSON.stringify({ items: fixturePairsByConfig[FIXTURE_STUDY_CONFIG_ID], next_cursor: null, config_id: FIXTURE_STUDY_CONFIG_ID }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await waitFor(() => expect(within(panel).getByRole("button", { name: "Confirm" })).toBeEnabled());
  });

  it("R3.12 Cancel drops the edited draft, so its failed read never shows over the solution", async () => {
    const user = userEvent.setup();
    renderStudy(`/study?${ONLINE_100}&pair=BB-BTN`, (request) =>
      request.path === `/api/v1/configs/${FIXTURE_DEEP_CONFIG_ID}/pairs` ? problemOf(500, "internal") : undefined,
    );
    await user.click(await screen.findByRole("button", { name: "Change settings" }));
    await user.click(choice("Depth", "200bb"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("img", { name: /frequency mode/ })).toBeInTheDocument();
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R3.12 a failed read of the draft's seats shows inside the panel, says so and retries there", async () => {
    const user = userEvent.setup();
    let failures = 1;
    renderStudy(`/study?${ONLINE_100}&pair=BB-BTN`, (request) => {
      if (request.path !== `/api/v1/configs/${FIXTURE_DEEP_CONFIG_ID}/pairs` || failures === 0) return undefined;
      failures -= 1;
      return problemOf(500, "internal");
    });
    await user.click(await screen.findByRole("button", { name: "Change settings" }));
    await user.click(choice("Depth", "200bb"));
    const panel = screen.getByRole("region", { name: "Spot settings" });
    const alert = await within(panel).findByRole("alert");
    expect(screen.getAllByRole("alert")).toEqual([alert]);
    expect(screen.queryByRole("img", { name: /range matrix/i })).not.toBeInTheDocument();
    expect(within(panel).getAllByText("The seats for these settings could not be loaded.").length).toBeGreaterThan(0);
    expect(within(panel).queryByText("Choose a depth first.")).not.toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(panel).getByRole("button", { name: "Confirm" })).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R3.12 a failed read of the URL configuration's seats says so in the panel too", async () => {
    renderStudy(`/study?${ONLINE_100}`, (request) =>
      request.path === `/api/v1/configs/${FIXTURE_STUDY_CONFIG_ID}/pairs` ? problemOf(500, "internal") : undefined,
    );
    const panel = await screen.findByRole("region", { name: "Spot settings" });
    expect(await screen.findByRole("alert")).toHaveTextContent("The game catalog could not be loaded.");
    expect(within(panel).getAllByText("The seats for these settings could not be loaded.").length).toBeGreaterThan(0);
    expect(within(panel).queryByText("Choose a depth first.")).not.toBeInTheDocument();
  });

  it("R3.12 a failed catalog read shows an error with a retry and no server detail", async () => {
    const user = userEvent.setup();
    let failures = 1;
    renderStudy("/study?format=online", (request) => {
      if (request.path !== "/api/v1/configs" || failures === 0) return undefined;
      failures -= 1;
      return problemOf(500, "internal");
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The game catalog could not be loaded.");
    expect(alert).not.toHaveTextContent("server detail text");
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await waitFor(() => choice("Table size", "6 players"))).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
