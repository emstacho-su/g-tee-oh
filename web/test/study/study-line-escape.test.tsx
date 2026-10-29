// Tests for the ways off a dead end on /study (S39 review round 1, R3.12, O-354): a line that fails
// to load offers a step back and a return to the spot's start built from the URL alone, and the
// carousel stays preflop: an action whose child is a postflop node is disabled with the v1.5
// reason, and a postflop node shows the v1.5 note with a way back and no carousel.
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudyNode } from "../../src/contracts.js";
import {
  FIXTURE_CHILD_LINE,
  FIXTURE_ONLINE_STAKE_ID,
  FIXTURE_STUDY_CONFIG_ID,
  FIXTURE_STUDY_PAIR,
  fixtureChildNode,
} from "../../src/fixtures/study.js";
import { studyNodeKey } from "../../src/study/queries.js";
import { nodeJson, problemOf, renderStudy, type StudyOverride } from "./render-study.js";

const BASE = `/study?format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000&pair=${FIXTURE_STUDY_PAIR}`;
const CLOSING_CALL_LINE = `${FIXTURE_CHILD_LINE}.c`;
const POSTFLOP_REASON = /Postflop study arrives in v1\.5/;

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

/** The child node with its call leading on to a flop node, which the store holds (synthetic). */
const childWithClosingCall: StudyNode = {
  ...fixtureChildNode,
  actions: fixtureChildNode.actions.map((action) =>
    action.token === "c" ? { ...action, next_node_key: `${FIXTURE_STUDY_CONFIG_ID}/${FIXTURE_STUDY_PAIR}/${CLOSING_CALL_LINE}` } : action,
  ),
};

const flopNode: StudyNode = {
  ...fixtureChildNode,
  node_key: `${FIXTURE_STUDY_CONFIG_ID}/${FIXTURE_STUDY_PAIR}/${CLOSING_CALL_LINE}`,
  street: "flop",
  to_act: "BB",
  next_likely_line: null,
  next_likely_node_key: null,
};

const closingCall: StudyOverride = (request) => {
  if (request.path !== "/api/v1/study/node") return undefined;
  if (request.query["line"] === FIXTURE_CHILD_LINE) return nodeJson(childWithClosingCall);
  if (request.query["line"] === CLOSING_CALL_LINE) return nodeJson(flopNode);
  return undefined;
};

describe("R3.12 a line that fails to load", () => {
  it("R3.12 a 404 line offers a step back and the spot's start, built from the URL", async () => {
    const user = userEvent.setup();
    const { router } = renderStudy(`${BASE}&line=${FIXTURE_CHILD_LINE}.x9`);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The library holds no solution for this pair and line.");
    expect(screen.getByRole("button", { name: "Back to the start of this spot" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back one decision" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ line: FIXTURE_CHILD_LINE }));
    expect(await screen.findByText(/BB to act/)).toBeInTheDocument();
  });

  it("R3.12 Back to the start of this spot opens the pair's root", async () => {
    const user = userEvent.setup();
    const { router } = renderStudy(`${BASE}&line=x9`);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Back one decision" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to the start of this spot" }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("line"));
    expect(await screen.findByText(/BTN to act/)).toBeInTheDocument();
  });

  it("R3.12 a failing root has nothing to step back to", async () => {
    renderStudy(BASE, (request) =>
      request.path === "/api/v1/study/node" ? new Response(null, { status: 404 }) : undefined,
    );
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: /^Back/ })).not.toBeInTheDocument();
  });
});

describe("R3.12 the carousel stays preflop", () => {
  it("R3.12 a preflop call that closes the action is disabled with the v1.5 reason", async () => {
    renderStudy(`${BASE}&line=${FIXTURE_CHILD_LINE}`, closingCall);
    const actions = await screen.findByRole("region", { name: "BB's actions" });
    const call = within(actions).getByRole("button", { name: /^Call/ });
    await waitFor(() => expect(call).toHaveAttribute("aria-disabled", "true"));
    expect(call).toHaveAccessibleName(POSTFLOP_REASON);
    expect(within(actions).getByRole("button", { name: /^Raise to 11bb/ })).not.toHaveAttribute("aria-disabled");
  });

  it("R3.12 a child read that failed leaves its action enabled", async () => {
    const { queryClient } = renderStudy(BASE, (request) =>
      request.path === "/api/v1/study/node" && request.query["line"] === FIXTURE_CHILD_LINE ? problemOf(503, "unavailable") : undefined,
    );
    const actions = await screen.findByRole("region", { name: "BTN's actions" });
    // Wait for the failure itself, an error-only signal, before checking the action.
    const childKey = studyNodeKey({ configId: FIXTURE_STUDY_CONFIG_ID, pair: FIXTURE_STUDY_PAIR, line: FIXTURE_CHILD_LINE });
    await waitFor(() => expect(queryClient.getQueryState(childKey)?.status).toBe("error"));
    const raise = within(actions).getByRole("button", { name: /^Raise to 2.5bb/ });
    expect(raise).not.toHaveAttribute("aria-disabled");
    expect(raise).not.toHaveAccessibleName(POSTFLOP_REASON);
  });

  it("R3.12 a child read still loading leaves its action enabled", async () => {
    const held = new Promise<Response>(() => undefined);
    const { nodeRequests } = renderStudy(BASE, (request) =>
      request.path === "/api/v1/study/node" && request.query["line"] === FIXTURE_CHILD_LINE ? held : undefined,
    );
    const actions = await screen.findByRole("region", { name: "BTN's actions" });
    await waitFor(() => expect(nodeRequests().map((request) => request.query["line"])).toContain(FIXTURE_CHILD_LINE));
    expect(within(actions).getByRole("button", { name: /^Raise to 2.5bb/ })).not.toHaveAttribute("aria-disabled");
  });

  it("R3.12 a postflop node shows the v1.5 note with a way back and no carousel", async () => {
    const user = userEvent.setup();
    const { router } = renderStudy(`${BASE}&line=${CLOSING_CALL_LINE}`, closingCall);
    expect(await screen.findByText("Postflop study arrives in v1.5. This node is on the flop.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Positions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /'s actions$/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back one decision" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ line: FIXTURE_CHILD_LINE }));
    expect(await screen.findByRole("region", { name: "BB's actions" })).toBeInTheDocument();
  });
});
