/**
 * Tests for the feedback panel's range view and threshold card wiring (S25, R3.13, O-281). Both
 * read the decided node only after the decision, through the shared study query factories, from
 * an injected fake fetch; the hero's hand may arrive as a class or as two cards.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppApi } from "../../src/api/index.js";
import { ApiProvider } from "../../src/auth/index.js";
import { FeedbackRangeView, FeedbackThreshold } from "../../src/components/trainer/index.js";
import type { DecisionFeedback, StudyInsights, StudyNode } from "../../src/contracts.js";
import { fixtureFeedback, fixtureInsights, fixtureStudyNode } from "../../src/fixtures/index.js";
import { heroHandClass } from "../../src/poker/hand-class.js";
import { studyNodeByKeyKey, studyNodeByKeyQuery } from "../../src/study/queries.js";
import { createFakeFetch, jsonResponse, networkFailure, problemResponse } from "../api/fake-fetch.js";
import type { FetchScript } from "../api/fake-fetch.js";

const ORIGIN = "http://localhost:4173";
const NODE_PATH = "GET /api/v1/study/node";
const INSIGHTS_PATH = "GET /api/v1/study/insights";

function setup(script: FetchScript, ui: ReactNode) {
  const fake = createFakeFetch(script);
  const api = createAppApi({ baseUrl: ORIGIN, fetch: fake.fetch });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>{ui}</ApiProvider>
    </QueryClientProvider>,
  );
  return { fake, view };
}

beforeEach(() => {
  // jsdom has no canvas; the matrix draws nothing and keeps its accessible table.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("R3.13 heroHandClass", () => {
  it.each([
    ["AJo", "AJo"],
    ["77", "77"],
    ["AhJd", "AJo"],
    ["JdAh", "AJo"],
    ["KsQs", "KQs"],
    ["7c7d", "77"],
    ["2h3h", "32s"],
  ])("R3.13 names %s as the class %s", (hand, expected) => {
    expect(heroHandClass(hand)).toBe(expected);
  });

  it.each(["", "AJ", "AhAh", "XxYy", "AJx", "AhJdK"])("R3.13 returns null for %j, which is neither a class nor two cards", (hand) => {
    expect(heroHandClass(hand)).toBeNull();
  });
});

describe("R3.13 studyNodeByKeyQuery", () => {
  it("R3.13 reads the node by config_id, pair and node_key, with its own stable key", async () => {
    const urls: string[] = [];
    const api = createAppApi({
      baseUrl: ORIGIN,
      fetch: (request) => {
        urls.push(request.url);
        return Promise.resolve(jsonResponse(200, fixtureStudyNode)());
      },
    });
    const params = { configId: "cfg_6_online_100", pair: "BB-BTN", nodeKey: "cfg_6_online_100/BB-BTN/" };
    const options = studyNodeByKeyQuery(api, params);
    expect(options.queryKey).toEqual(studyNodeByKeyKey(params));
    expect(options.queryKey).toEqual(["study", "node-key", "cfg_6_online_100", "BB-BTN", "cfg_6_online_100/BB-BTN/"]);
    const node = await new QueryClient().fetchQuery(options);
    expect(node.node_key).toBe(fixtureStudyNode.node_key);
    const query = new URL(urls[0] ?? "").searchParams;
    expect(Object.fromEntries(query)).toEqual({
      config_id: "cfg_6_online_100",
      pair: "BB-BTN",
      node_key: "cfg_6_online_100/BB-BTN/",
    });
  });

  it("R3.13 a response without data becomes an ApiProblem with the status and slug", async () => {
    const api = createAppApi({ baseUrl: ORIGIN, fetch: () => Promise.resolve(problemResponse(404, "not-found")()) });
    const options = studyNodeByKeyQuery(api, { configId: "cfg_6_online_100", pair: "BB-BTN", nodeKey: "k" });
    await expect(new QueryClient().fetchQuery(options)).rejects.toMatchObject({ status: 404, slug: "not-found" });
  });
});

describe("R3.13 FeedbackRangeView", () => {
  it("R3.13 shows a loading state, then the decided node's matrix in frequency mode with the hero's class selected", async () => {
    setup({ [NODE_PATH]: [jsonResponse(200, fixtureStudyNode)] }, <FeedbackRangeView feedback={fixtureFeedback} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the range at this decision");
    const view = await screen.findByTestId("feedback-range-view");
    expect(view).toHaveAttribute("data-selected-hand", "AJo");
    expect(view).toHaveAttribute("data-mode", "frequency");
    expect(screen.getByRole("img", { name: /frequency/i })).toBeInTheDocument();
    expect(view).toHaveTextContent("Your hand, AJo, is highlighted");
  });

  it("R3.13 converts a two-card hand to its class for the selection", async () => {
    const feedback: DecisionFeedback = { ...fixtureFeedback, hand: "KsQs" };
    setup({ [NODE_PATH]: [jsonResponse(200, fixtureStudyNode)] }, <FeedbackRangeView feedback={feedback} />);
    expect(await screen.findByTestId("feedback-range-view")).toHaveAttribute("data-selected-hand", "KQs");
  });

  it("R3.13 a hand that is neither a class nor two cards still shows the range, with no selection and a note", async () => {
    const feedback: DecisionFeedback = { ...fixtureFeedback, hand: "??" };
    setup({ [NODE_PATH]: [jsonResponse(200, fixtureStudyNode)] }, <FeedbackRangeView feedback={feedback} />);
    const view = await screen.findByTestId("feedback-range-view");
    expect(view).not.toHaveAttribute("data-selected-hand");
    expect(view).toHaveTextContent("Your hand could not be placed on the matrix");
  });

  it("R3.13 a postflop node shows the v1.5 note instead of the matrix", async () => {
    const flop: StudyNode = { ...fixtureStudyNode, street: "flop" };
    setup({ [NODE_PATH]: [jsonResponse(200, flop)] }, <FeedbackRangeView feedback={fixtureFeedback} />);
    expect(await screen.findByTestId("feedback-range-view-postflop")).toHaveTextContent("v1.5");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("R3.13 an error is explicit, shows the status without server detail, and Retry reads again", async () => {
    const { fake } = setup(
      { [NODE_PATH]: [problemResponse(503, "solver-query-unavailable"), jsonResponse(200, fixtureStudyNode)] },
      <FeedbackRangeView feedback={fixtureFeedback} />,
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The range at this decision could not load (status 503)");
    expect(alert).not.toHaveTextContent("server detail text");
    await userEvent.click(screen.getByRole("button", { name: "Retry the range" }));
    expect(await screen.findByTestId("feedback-range-view")).toBeInTheDocument();
    expect(fake.keys()).toEqual([NODE_PATH, NODE_PATH]);
  });

  it("R3.13 a network failure is explicit too", async () => {
    setup({ [NODE_PATH]: [networkFailure()] }, <FeedbackRangeView feedback={fixtureFeedback} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The range at this decision could not load (network error)");
  });
});

describe("R3.13 FeedbackThreshold", () => {
  it("R3.13 loads the threshold card for the decided node and the hero's hand", async () => {
    const { fake } = setup({ [INSIGHTS_PATH]: [jsonResponse(200, fixtureInsights)] }, <FeedbackThreshold feedback={fixtureFeedback} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the threshold card");
    const card = await screen.findByTestId("threshold-card");
    expect(card).toHaveTextContent("Your hand: AJo");
    expect(fake.keys()).toEqual([INSIGHTS_PATH]);
  });

  it("R3.13 sends the hand as the api received it, and marks the class on the card", async () => {
    const urls: string[] = [];
    const api = createAppApi({
      baseUrl: ORIGIN,
      fetch: (request) => {
        urls.push(request.url);
        return Promise.resolve(jsonResponse(200, fixtureInsights)());
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const feedback: DecisionFeedback = { ...fixtureFeedback, hand: "AhJd" };
    render(
      <QueryClientProvider client={queryClient}>
        <ApiProvider api={api}>
          <FeedbackThreshold feedback={feedback} />
        </ApiProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("threshold-card")).toHaveTextContent("Your hand: AJo");
    expect(Object.fromEntries(new URL(urls[0] ?? "").searchParams)).toEqual({
      solution_id: fixtureFeedback.solution_id,
      node_key: fixtureFeedback.node_key,
      hand: "AhJd",
    });
  });

  it("R3.13 a node with no threshold card says so", async () => {
    const insights: StudyInsights = { ...fixtureInsights, threshold_card: null };
    setup({ [INSIGHTS_PATH]: [jsonResponse(200, insights)] }, <FeedbackThreshold feedback={fixtureFeedback} />);
    expect(await screen.findByTestId("threshold-card")).toHaveTextContent("No threshold data for this node");
  });

  it("R3.13 a hand-not-in-range 404 says the hand is outside the node's range", async () => {
    setup({ [INSIGHTS_PATH]: [problemResponse(404, "hand-not-in-range")] }, <FeedbackThreshold feedback={fixtureFeedback} />);
    const note = await screen.findByTestId("feedback-threshold-out-of-range");
    expect(note).toHaveTextContent("Your hand, AJo, is outside this node's range");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R3.13 other errors are explicit alerts with the status and no server detail, and Retry reads again", async () => {
    const { fake } = setup(
      { [INSIGHTS_PATH]: [problemResponse(502, "solver-query-error"), jsonResponse(200, fixtureInsights)] },
      <FeedbackThreshold feedback={fixtureFeedback} />,
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The threshold card could not load (status 502)");
    expect(alert).not.toHaveTextContent("server detail text");
    await userEvent.click(screen.getByRole("button", { name: "Retry the threshold card" }));
    await waitFor(() => expect(screen.getByTestId("threshold-card")).toBeInTheDocument());
    expect(fake.keys()).toEqual([INSIGHTS_PATH, INSIGHTS_PATH]);
  });

  it("R3.13 a 404 of another kind is an error, not the out-of-range note", async () => {
    setup({ [INSIGHTS_PATH]: [problemResponse(404, "not-found")] }, <FeedbackThreshold feedback={fixtureFeedback} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The threshold card could not load (status 404)");
  });
});
