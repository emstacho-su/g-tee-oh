/**
 * The /library coverage view (S28, R3.4, O-240, O-291, O-297, ADR 0018): the pair grid, the
 * selected pair's families and queue with positions, gap requests from an uncovered selection
 * and live updates over SSE (server-sent events), against the mocked api of
 * e2e/support/mock-library.ts.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CSRF_HEADER } from "../../src/api/index.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import { FIXTURE_QUEUE_PAIR, FIXTURE_REQUESTED_FLOP } from "../../src/fixtures/library.js";
import { FIXTURE_ONLINE_STAKE_ID, FIXTURE_STUDY_CONFIG_ID } from "../../src/fixtures/study.js";
import { jsonBody, libraryPath, renderLibrary } from "./render-library.js";

const REQUESTS_PATH = "/api/v1/coverage/requests";
const COVERAGE_PATH = "/api/v1/coverage";
const UNCOVERED_PAIR = "CO-BTN";
/** The pairs read in words since S47 (spot-words.ts); the tokens stay in the requests. */
const UNCOVERED_WORDS = "cutoff versus button";
const QUEUE_WORDS = "Big blind versus button";

/** Each queue row as [position, flop]. */
function queuePositions(): string[][] {
  const table = screen.getByRole("table", { name: "Build queue for this pair" });
  const bodyRows = within(table).getAllByRole("row").slice(1);
  return bodyRows.map((row) => {
    const position = within(row).getAllByRole("cell")[0]?.textContent ?? "";
    const flop = within(row).getByRole("rowheader").textContent ?? "";
    return [position, flop];
  });
}

describe("R3.4 coverage view", () => {
  it("R3.4 the grid lists every pair of the configuration with its preflop availability in words", async () => {
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID));

    const pairs = await screen.findByRole("list", { name: "Pairs" });
    const cells = within(pairs).getAllByRole("button");
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "Big blind versus buttonIn the library",
      "Small blind versus buttonIn the library",
      "Cutoff versus buttonNot in the library",
      "Under the gun versus hijackNot in the library",
    ]);
    expect(screen.getByText("2 of 4 pairs are in the library at this configuration.")).toBeInTheDocument();
    expect(screen.getByText("Choose a pair to see its flops and queue, or to request it.")).toBeInTheDocument();
  });

  it("R3.4 selecting a pair writes it to the URL and shows its families and queue in claim order with positions", async () => {
    const user = userEvent.setup();
    const { router } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID));

    await user.click(await screen.findByRole("button", { name: new RegExp(`^${QUEUE_WORDS}`) }));

    await screen.findByRole("table", { name: "Build queue for this pair" });
    expect(router.state.location.search).toMatchObject({ pair: "BB-BTN" });
    expect(screen.getByRole("button", { name: new RegExp(`^${QUEUE_WORDS}`) })).toHaveAttribute("aria-pressed", "true");
    expect(queuePositions()).toEqual([
      ["1", "Kd8s3h"],
      ["2", "Qc9h4d"],
      ["3", "Th6c2s"],
    ]);
    const families = screen.getByRole("table", { name: "Flops by texture family" });
    expect(within(families).getByRole("row", { name: /Dry ace high/ })).toHaveTextContent("Dry ace high240");
    expect(within(families).getByRole("row", { name: /Monotone/ })).toHaveTextContent("Monotone110");
    expect(within(families).getByRole("row", { name: /^Other/ })).toHaveTextContent("Other00");
    expect(screen.getByTestId("synthetic-banner")).toBeInTheDocument();
  });

  it("R3.4 requesting a queued flop sends the CSRF token and an Idempotency-Key and shows queue position 1, with the queue reordered", async () => {
    const user = userEvent.setup();
    const { sent } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_QUEUE_PAIR));

    await user.click(await screen.findByRole("button", { name: `Request ${FIXTURE_REQUESTED_FLOP}` }));

    expect(await screen.findByTestId("gap-request-result")).toHaveTextContent(
      `${QUEUE_WORDS} on ${FIXTURE_REQUESTED_FLOP}: Queued for the builder at position 1.`,
    );
    const [request] = sent("POST", REQUESTS_PATH);
    expect(request?.body).toEqual({ config_id: FIXTURE_STUDY_CONFIG_ID, pair: FIXTURE_QUEUE_PAIR, flop: FIXTURE_REQUESTED_FLOP });
    expect(request?.headers[CSRF_HEADER]).toBe(FIXTURE_CSRF_TOKEN);
    expect(request?.headers["idempotency-key"]).toBe("test-key-1");
    await waitFor(() => expect(queuePositions()[0]).toEqual(["1", FIXTURE_REQUESTED_FLOP]));
    expect(sent("GET", COVERAGE_PATH).length).toBeGreaterThanOrEqual(2);
  });

  it("R3.4 an uncovered pair offers a preflop request, which answers recorded with no queue position", async () => {
    const user = userEvent.setup();
    const { sent } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, UNCOVERED_PAIR));

    expect(await screen.findByText("The preflop solution is not in the library.")).toBeInTheDocument();
    expect(screen.getByText("No build is queued for this pair.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `Request ${UNCOVERED_WORDS} preflop` }));

    expect(await screen.findByTestId("gap-request-result")).toHaveTextContent(
      `Cutoff versus button preflop: Recorded for the planner. There is no build job for this spot yet, so it has no queue position.`,
    );
    expect(sent("POST", REQUESTS_PATH)[0]?.body).toEqual({ config_id: FIXTURE_STUDY_CONFIG_ID, pair: UNCOVERED_PAIR });
  });

  it("R3.4 a covered pair has no preflop request; a typed covered flop answers covered", async () => {
    const user = userEvent.setup();
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_QUEUE_PAIR));

    await screen.findByRole("table", { name: "Build queue for this pair" });
    expect(screen.queryByRole("button", { name: /preflop$/ })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Flop" }), "ah 7D 2c");
    await user.click(screen.getByRole("button", { name: "Request this flop" }));

    expect(await screen.findByTestId("gap-request-result")).toHaveTextContent(`${QUEUE_WORDS} on Ah7d2c: Already in the library. Nothing was queued.`);
  });

  it("R3.4 a blocked_budget answer says it waits on the storage budget with no position", async () => {
    const user = userEvent.setup();
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_QUEUE_PAIR), {
      override: (request) =>
        request.path === REQUESTS_PATH
          ? jsonBody(202, { status: "blocked_budget", job_id: "00000000-0000-4000-8000-0000000000d1", priority: 0.2, queue_position: null })
          : undefined,
    });

    await user.type(await screen.findByRole("textbox", { name: "Flop" }), "9h8h7c");
    await user.click(screen.getByRole("button", { name: "Request this flop" }));

    expect(await screen.findByTestId("gap-request-result")).toHaveTextContent(
      `${QUEUE_WORDS} on 9h8h7c: Waiting on the storage budget, so it has no queue position yet. The request is recorded.`,
    );
  });

  it("R3.4 a flop that is not three different cards is refused before anything is sent", async () => {
    const user = userEvent.setup();
    const { sent } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_QUEUE_PAIR));

    await user.type(await screen.findByRole("textbox", { name: "Flop" }), "AhAh2c");
    await user.click(screen.getByRole("button", { name: "Request this flop" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Type three different cards, rank then suit, for example KhQd4s.");
    expect(screen.getByRole("textbox", { name: "Flop" })).toHaveAttribute("aria-invalid", "true");
    expect(sent("POST", REQUESTS_PATH)).toEqual([]);
  });

  it("R3.4 a failed request shows a fixed message and never the server's detail text", async () => {
    const user = userEvent.setup();
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_QUEUE_PAIR), {
      override: (request) =>
        request.path === REQUESTS_PATH
          ? jsonBody(503, { type: "urn:g-tee-oh:problem:unavailable", title: "t", status: 503, detail: "server detail text" }, "application/problem+json")
          : undefined,
    });

    await user.click(await screen.findByRole("button", { name: `Request ${FIXTURE_REQUESTED_FLOP}` }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The solver service is busy right now. Try again.");
    expect(screen.queryByText(/server detail text/)).not.toBeInTheDocument();
  });

  it("R3.4 a coverage read without solver-query's database says so instead of showing an empty library", async () => {
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_QUEUE_PAIR), {
      override: (request) =>
        request.path === COVERAGE_PATH
          ? jsonBody(200, {
              config_id: FIXTURE_STUDY_CONFIG_ID,
              pair: FIXTURE_QUEUE_PAIR,
              preflop_available: true,
              flops: [],
              queue: [],
              synthetic: false,
              database: "unavailable",
            })
          : undefined,
    });

    expect(await screen.findByRole("note")).toHaveTextContent("could not reach its database");
    expect(screen.queryByRole("table", { name: "Build queue for this pair" })).not.toBeInTheDocument();
  });

  it("R3.4 a failed coverage read shows an alert with a retry", async () => {
    const user = userEvent.setup();
    let fail = true;
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_QUEUE_PAIR), {
      override: (request) => (request.path === COVERAGE_PATH && fail ? jsonBody(502, { status: 502 }) : undefined),
    });

    expect(await screen.findByText("The coverage for this pair could not be loaded.")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table", { name: "Build queue for this pair" })).toBeInTheDocument();
  });
});

describe("R3.4 live updates", () => {
  it("R3.4 one stream opens on /library; coverage_added for this configuration refetches the coverage and pairs and is announced", async () => {
    const { streams, sent } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_QUEUE_PAIR));
    await screen.findByRole("table", { name: "Build queue for this pair" });
    expect(streams).toHaveLength(1);
    expect(streams[0]?.url).toBe("/api/v1/events");
    expect(screen.getByTestId("live-status")).toHaveTextContent("Connecting to live updates.");
    streams[0]?.open();
    expect(screen.getByTestId("live-status")).toHaveTextContent("Live updates are on.");
    const coverageReads = sent("GET", COVERAGE_PATH).length;
    const pairsReads = sent("GET", `/api/v1/configs/${FIXTURE_STUDY_CONFIG_ID}/pairs`).length;

    streams[0]?.emit("coverage_added", {
      config_id: FIXTURE_STUDY_CONFIG_ID,
      pair: FIXTURE_QUEUE_PAIR,
      flop: "Kd8s3h",
      build_id: "b1",
      scenario_count: 20,
    });

    expect(screen.getByTestId("live-coverage")).toHaveTextContent(`New coverage: ${QUEUE_WORDS} on Kd8s3h, 20 scenarios (pre-dealt runouts).`);
    await waitFor(() => expect(sent("GET", COVERAGE_PATH).length).toBe(coverageReads + 1));
    await waitFor(() => expect(sent("GET", `/api/v1/configs/${FIXTURE_STUDY_CONFIG_ID}/pairs`).length).toBe(pairsReads + 1));
  });

  it("R3.4 coverage_added for another configuration and malformed events are ignored", async () => {
    const { streams, sent } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_QUEUE_PAIR));
    await screen.findByRole("table", { name: "Build queue for this pair" });
    const coverageReads = sent("GET", COVERAGE_PATH).length;

    streams[0]?.emit("coverage_added", { config_id: "cfg_9_live_13_100", pair: "BB-BTN", flop: "Kd8s3h", build_id: "b1", scenario_count: 20 });
    streams[0]?.emit("coverage_added", "{not json");
    streams[0]?.emit("coverage_added", { config_id: FIXTURE_STUDY_CONFIG_ID, pair: "BB-BTN", flop: "Kd8s3h" });

    expect(screen.getByTestId("live-coverage")).toHaveTextContent("");
    expect(sent("GET", COVERAGE_PATH).length).toBe(coverageReads);
  });

  it("R3.4 a stream the browser gave up on offers a reconnect, which opens a fresh one and closes nothing twice", async () => {
    const user = userEvent.setup();
    const { streams } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID));
    await screen.findByRole("list", { name: "Pairs" });

    streams[0]?.fail(false);
    expect(screen.getByTestId("live-status")).toHaveTextContent("Connecting to live updates.");
    streams[0]?.fail(true);
    expect(screen.getByTestId("live-status")).toHaveTextContent("Live updates stopped.");
    await user.click(screen.getByRole("button", { name: "Reconnect" }));

    expect(streams).toHaveLength(2);
    expect(streams[0]?.closed).toBe(true);
    expect(screen.getByTestId("live-status")).toHaveTextContent("Connecting to live updates.");
  });

  it("R3.4 leaving /library closes its stream", async () => {
    const { streams, router } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID));
    await screen.findByRole("list", { name: "Pairs" });

    await router.navigate({ to: "/" });

    await screen.findByRole("heading", { level: 1, name: "Home" });
    expect(streams[0]?.closed).toBe(true);
  });
});
