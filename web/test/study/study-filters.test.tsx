// Tests for the /study filters on the rendered screen (S25, R3.12, O-286): the URL drives the
// state, uncovered pairs are disabled, no node is read before the config and pair are known, a
// failed catalog read shows an error with a retry, and the node switch line is logged.
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_ONLINE_STAKE_ID, FIXTURE_STUDY_CONFIG_ID } from "../../src/fixtures/study.js";
import { validateStudySearch } from "../../src/study/search.js";
import { problemOf, renderStudy } from "./render-study.js";

const NODE_SWITCH_LINE = /^g-tee-oh node-switch \d+\.\d ms root$/;

// Only this file's spies are restored: restoring all would undo setup.ts's scrollTo stub.
let spies: { mockRestore: () => void }[] = [];

beforeEach(() => {
  // jsdom has no 2D canvas; the matrix then skips drawing and keeps its table (S24).
  spies = [vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)];
});

afterEach(() => {
  spies.forEach((spy) => spy.mockRestore());
});

describe("R3.12 study filters", () => {
  it("R3.12 with no filters the screen asks for the format and reads nothing", async () => {
    const { requests } = renderStudy("/study");
    expect(await screen.findByRole("heading", { level: 1, name: "Solution browser" })).toBeInTheDocument();
    expect(screen.getByText("Choose a format to start.")).toBeInTheDocument();
    expect(screen.getByLabelText("Table size")).toBeDisabled();
    expect(requests.filter((request) => request.path !== "/api/v1/me")).toEqual([]);
  });

  it("R3.12 the selects resolve a config_id, disable uncovered pairs and open the node, logging the switch", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    spies.push(info);
    const user = userEvent.setup();
    const { router, nodeRequests } = renderStudy("/study");

    await user.selectOptions(await screen.findByLabelText("Format"), "online");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Table size" }), "6");
    await waitFor(() => expect(screen.getByLabelText("Stake")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("Stake"), "online");
    await waitFor(() => expect(screen.getByLabelText("Depth")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("Depth"), "100bb");
    await waitFor(() => expect(screen.getByLabelText("Pair")).toBeEnabled());
    expect(nodeRequests()).toEqual([]);

    const pairSelect = screen.getByLabelText("Pair");
    expect(within(pairSelect).getByRole("option", { name: "CO-BTN (Not in the library)" })).toBeDisabled();
    expect(within(pairSelect).getByRole("option", { name: "BB-BTN" })).toBeEnabled();
    await user.selectOptions(pairSelect, "BB-BTN");

    expect(await screen.findByRole("img", { name: /frequency mode/ })).toBeInTheDocument();
    // The URL holds strings (search-serialization.ts); the validator turns the numeric filters back.
    expect(router.state.location.search).toEqual({
      format: "online",
      table_size: "6",
      stake: FIXTURE_ONLINE_STAKE_ID,
      depth: "10000",
      pair: "BB-BTN",
    });
    expect(validateStudySearch(router.state.location.search)).toEqual({
      format: "online",
      table_size: 6,
      stake: FIXTURE_ONLINE_STAKE_ID,
      depth: 10000,
      pair: "BB-BTN",
    });
    expect(nodeRequests()[0]?.query).toEqual({ config_id: FIXTURE_STUDY_CONFIG_ID, pair: "BB-BTN" });
    await waitFor(() => expect(info).toHaveBeenCalledOnce());
    expect(info.mock.calls[0]?.[0]).toMatch(NODE_SWITCH_LINE);
  });

  it("R3.12 a configuration with no covered pair selected asks for the pair", async () => {
    renderStudy(`/study?format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000`);
    expect(await screen.findByText("Choose a pair to open its root node.")).toBeInTheDocument();
  });

  it("R3.12 an uncovered pair in the URL says it is not in the library and reads no node", async () => {
    const { nodeRequests } = renderStudy(`/study?format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000&pair=CO-BTN`);
    expect(await screen.findByText("CO-BTN is not in the library at this configuration.")).toBeInTheDocument();
    expect(nodeRequests()).toEqual([]);
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
    await waitFor(() => expect(screen.getByLabelText("Table size")).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R3.12 changing the format clears the filters below it", async () => {
    const user = userEvent.setup();
    const { router } = renderStudy(`/study?format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000&mode=ev`);
    await waitFor(() => expect(screen.getByLabelText("Pair")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("Format"), "live");
    await waitFor(() => expect(router.state.location.search).toEqual({ format: "live", mode: "ev" }));
  });
});
