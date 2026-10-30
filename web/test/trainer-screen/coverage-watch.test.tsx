/**
 * Start again when the library catches up (S47, R3.4, ADR 0018; PR #48 review MEDIUM 4): after a
 * 422 no-coverage the run screen opens one event stream. A coverage_added counts only for a
 * configuration and a pair the drill reaches; the configuration's pairs are read again, and Start
 * is offered only when that read shows one of the drill's pairs covered. An event for another
 * configuration or another pair does nothing, an event that arrives before the configuration list
 * has loaded is checked once it has, and the stream closes when the refusal leaves the screen.
 */
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fixtureConfigs, fixturePairsByConfig } from "../../src/fixtures/study.js";
import { fixtureDrill, fixturePlainPrompt, fixturePracticeSession } from "../../src/fixtures/trainer.js";
import { jsonResponse, problemResponse, type ResponseFactory } from "../api/fake-fetch.js";
import { FakeEventStream } from "../library/render-library.js";
import { NEXT_PATH, START_PATH, renderRun, type RunView } from "./render-run.js";

const CONFIGS_PATH = "GET /api/v1/configs";
const PAIRS_PATH = "GET /api/v1/configs/cfg_6_online_100/pairs";
/** The fixture drill: hero BTN against BB at online 6-max 100bb, so its one pair is BB-BTN. */
const EVENT = { config_id: "cfg_6_online_100", pair: "BB-BTN", flop: "Kd8s3h", build_id: "b1", scenario_count: 20 };
const CONFIGS = jsonResponse(200, { items: fixtureConfigs, next_cursor: null });
const PAIRS = fixturePairsByConfig["cfg_6_online_100"] ?? [];
const pairsWith = (available: boolean): ResponseFactory =>
  jsonResponse(200, { items: PAIRS.map((pair) => (pair.pair === "BB-BTN" ? { ...pair, preflop_available: available } : pair)), next_cursor: null });

function withStreams() {
  const streams: FakeEventStream[] = [];
  let keyCount = 0;
  const deps = {
    openEvents: (url: string) => {
      const stream = new FakeEventStream(url);
      streams.push(stream);
      return stream;
    },
    newKey: () => `lib-key-${(keyCount += 1)}`,
  };
  return { streams, deps };
}

async function refuse(view: RunView, streams: readonly FakeEventStream[]): Promise<void> {
  await screen.findByRole("heading", { name: fixtureDrill.name });
  expect(streams).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Start session" }));
  await screen.findByRole("alert");
  await waitFor(() => expect(streams).toHaveLength(1));
  expect(view.sentTo(START_PATH)).toHaveLength(1);
  streams[0]?.open();
}

describe("R3.4 Start again on coverage_added", () => {
  it("R3.4 a coverage_added for the drill's pair clears the refusal once the re-read shows it covered, and Start works", async () => {
    const { streams, deps } = withStreams();
    const view = renderRun({
      libraryDeps: deps,
      script: {
        [START_PATH]: [problemResponse(422, "no-coverage"), jsonResponse(201, fixturePracticeSession)],
        [CONFIGS_PATH]: [CONFIGS],
        [PAIRS_PATH]: [pairsWith(false), pairsWith(true)],
        [NEXT_PATH]: [jsonResponse(200, fixturePlainPrompt)],
      },
    });
    await refuse(view, streams);
    expect(screen.getByTestId("coverage-watch")).toHaveTextContent("Watching the library");
    // The re-read still shows the pair uncovered (a flop build, say): keep watching.
    streams[0]?.emit("coverage_added", EVENT);
    await waitFor(() => expect(view.sentTo(PAIRS_PATH)).toHaveLength(1));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    streams[0]?.emit("coverage_added", EVENT);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(view.sentTo(PAIRS_PATH)).toHaveLength(2);
    expect(screen.getByTestId("start-note")).toHaveTextContent("The library just added Big blind versus button at Online, 6 players, 100bb deep. Start again.");
    await waitFor(() => expect(streams[0]?.closed).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    await screen.findByRole("group", { name: "Actions" });
  });

  it("R3.4 an event for another configuration or another pair at the same configuration does nothing", async () => {
    const { streams, deps } = withStreams();
    const view = renderRun({
      libraryDeps: deps,
      script: { [START_PATH]: [problemResponse(422, "no-coverage")], [CONFIGS_PATH]: [CONFIGS], [PAIRS_PATH]: [pairsWith(true)] },
    });
    await refuse(view, streams);
    await waitFor(() => expect(view.sentTo(CONFIGS_PATH).length).toBeGreaterThan(0));
    streams[0]?.emit("coverage_added", { ...EVENT, config_id: "cfg_9_live_13_100" });
    streams[0]?.emit("coverage_added", { ...EVENT, pair: "SB-BTN" });
    // Give the watch a moment: nothing is read and the refusal stays.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(view.sentTo(PAIRS_PATH)).toHaveLength(0);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("start-note")).not.toBeInTheDocument();
  });

  it("R3.4 an event that arrives before the configuration list has loaded is checked once it has", async () => {
    const { streams, deps } = withStreams();
    let releaseConfigs: () => void = () => undefined;
    const lateConfigs: ResponseFactory = () =>
      new Promise((resolve) => {
        releaseConfigs = () => resolve(new Response(JSON.stringify({ items: fixtureConfigs, next_cursor: null }), { status: 200, headers: { "content-type": "application/json" } }));
      });
    const view = renderRun({
      libraryDeps: deps,
      script: { [START_PATH]: [problemResponse(422, "no-coverage")], [CONFIGS_PATH]: [lateConfigs], [PAIRS_PATH]: [pairsWith(true)] },
    });
    await refuse(view, streams);
    streams[0]?.emit("coverage_added", EVENT);
    expect(view.sentTo(PAIRS_PATH)).toHaveLength(0);
    releaseConfigs();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByTestId("start-note")).toHaveTextContent("Start again.");
  });

  it("R3.4 without a refusal the run screen opens no stream", async () => {
    const { streams, deps } = withStreams();
    renderRun({ libraryDeps: deps, script: { [NEXT_PATH]: [jsonResponse(200, fixturePlainPrompt)] } });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    await screen.findByRole("group", { name: "Actions" });
    expect(streams).toHaveLength(0);
  });
});
