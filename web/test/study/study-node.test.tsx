// Tests for the /study node view (S25, R3.12, A7 sections 3 and 4, O-280, O-286, O-287): the three
// matrix modes, the actions tables, the threshold card for a selected hand only, the synthetic
// banner, the postflop note and the explicit error states. Moving along the line and the prefetch
// of the next likely line belong to the position carousel (study-carousel.test.tsx, S39).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FIXTURE_CHILD_LINE,
  FIXTURE_ONLINE_STAKE_ID,
  FIXTURE_OUT_OF_RANGE_HAND,
  FIXTURE_STUDY_PAIR,
  fixtureRootNode,
} from "../../src/fixtures/study.js";
import { nodeJson, problemOf, renderStudy, type StudyOverride } from "./render-study.js";

const BASE = `/study?format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000&pair=${FIXTURE_STUDY_PAIR}`;

function isNodeRead(path: string): boolean {
  return path === "/api/v1/study/node";
}

// Only this file's spies are restored: restoring all would undo setup.ts's scrollTo stub.
let spies: { mockRestore: () => void }[] = [];

beforeEach(() => {
  spies = [
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null),
    vi.spyOn(console, "info").mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  spies.forEach((spy) => spy.mockRestore());
});

describe("R3.12 study node view", () => {
  it("R3.12 each matrix mode renders and the toggle writes the mode to the URL", async () => {
    const user = userEvent.setup();
    const { router } = renderStudy(BASE);
    expect(await screen.findByRole("img", { name: "Range matrix, frequency mode, 169 hands" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "EV" }));
    expect(await screen.findByRole("img", { name: /expected value mode/ })).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({ mode: "ev" });

    await user.click(screen.getByRole("radio", { name: "Range weight" }));
    expect(await screen.findByRole("img", { name: /range weight mode/ })).toBeInTheDocument();
  });

  it("R3.12 the actions table shows range_by_action shares; a selected hand adds its own row", async () => {
    renderStudy(`${BASE}&hand=AKs`);
    const range = await screen.findByRole("table", { name: "Range by action at this node" });
    expect(within(range).getByRole("row", { name: /Fold/ })).toHaveTextContent("55.0%");
    expect(within(range).getByRole("row", { name: /Raise to 2.5bb/ })).toHaveTextContent("38.0%");
    const hand = screen.getByRole("table", { name: "AKs at this node: strategy and EV" });
    expect(within(hand).getAllByRole("row")).toHaveLength(5);
    expect(hand).toHaveTextContent("bb");
  });

  it("R3.12 a range_by_action that does not match the actions renders an alert", async () => {
    const broken = { ...fixtureRootNode, range_by_action: fixtureRootNode.range_by_action.slice(1) };
    renderStudy(BASE, (request) => (isNodeRead(request.path) ? nodeJson(broken) : undefined));
    expect(await screen.findByText("Cannot show the range by action: 4 actions but 3 range shares.")).toHaveAttribute(
      "role",
      "alert",
    );
  });

  it("R3.12 the threshold card loads only for a selected hand", async () => {
    const user = userEvent.setup();
    const { requests, router } = renderStudy(BASE);
    expect(await screen.findByText("Pick a cell in the matrix to see that hand's threshold card.")).toBeInTheDocument();
    expect(requests.some((request) => request.path === "/api/v1/study/insights")).toBe(false);

    const grid = screen.getByRole("group", { name: /range matrix cells/i });
    grid.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ hand: "AA" }));
    const card = await screen.findByTestId("threshold-card");
    expect(card).toHaveTextContent("Your hand: AA");
    const insights = requests.filter((request) => request.path === "/api/v1/study/insights");
    expect(insights.map((request) => request.query["hand"])).toEqual(["AA"]);
  });

  it("R3.12 a hand that left the range says so instead of a card", async () => {
    renderStudy(`${BASE}&hand=${FIXTURE_OUT_OF_RANGE_HAND}`);
    expect(await screen.findByText("72o is not in the range at this node, so it has no threshold card.")).toBeInTheDocument();
  });

  it("R3.12 a synthetic node shows the synthetic banner and noise flags show as text", async () => {
    renderStudy(`${BASE}&line=${FIXTURE_CHILD_LINE}`);
    expect(await screen.findByTestId("synthetic-banner")).toHaveTextContent("Synthetic data: an illustrative fixture, not a solved spot.");
    expect(screen.getByRole("list", { name: "Noise flags" })).toHaveTextContent("Close EV mix");
  });

  it("R3.12 a solved node shows no synthetic banner, and a hand with no row says it is not in the range", async () => {
    const solved = {
      ...fixtureRootNode,
      synthetic: false,
      hands: fixtureRootNode.hands.filter((row) => row.hand !== "AKs"),
    };
    renderStudy(`${BASE}&hand=AKs`, (request) => (isNodeRead(request.path) ? nodeJson(solved) : undefined));
    expect(await screen.findByText("AKs is not in the range at this node.")).toBeInTheDocument();
    expect(screen.queryByTestId("synthetic-banner")).not.toBeInTheDocument();
  });

  it("R3.12 a postflop node renders the v1.5 note and no matrix", async () => {
    const flop = { ...fixtureRootNode, street: "flop" as const };
    renderStudy(BASE, (request) => (isNodeRead(request.path) ? nodeJson(flop) : undefined));
    expect(await screen.findByText("Postflop study arrives in v1.5. This node is on the flop.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /range matrix/i })).not.toBeInTheDocument();
  });
});

describe("R3.12 study node errors", () => {
  function failingOnce(status: number, slug: string): StudyOverride {
    let failed = false;
    return (request) => {
      if (!isNodeRead(request.path) || failed) return undefined;
      failed = true;
      return problemOf(status, slug);
    };
  }

  it("R3.12 a 404 says the library holds no solution, with no retry and no server detail", async () => {
    renderStudy(BASE, (request) => (isNodeRead(request.path) ? problemOf(404, "not-found") : undefined));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The library holds no solution for this pair and line.");
    expect(alert).not.toHaveTextContent("server detail text");
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
  });

  it.each([
    [502, "upstream", "The solver service failed to answer."],
    [503, "unavailable", "The solver service is busy right now."],
  ])("R3.12 a %i shows its message and a retry that reloads the node", async (status, slug, message) => {
    const { nodeRequests } = renderStudy(BASE, failingOnce(status, slug));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("img", { name: /frequency mode/ })).toBeInTheDocument();
    expect(nodeRequests().length).toBeGreaterThanOrEqual(2);
  });

  it("R3.12 an insights failure is retryable for a 503", async () => {
    let failed = false;
    renderStudy(`${BASE}&hand=AKs`, (request) => {
      if (request.path !== "/api/v1/study/insights" || failed) return undefined;
      failed = true;
      return problemOf(503, "unavailable");
    });
    const alert = await screen.findByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("threshold-card")).toHaveTextContent("Your hand: AKs");
  });
});
