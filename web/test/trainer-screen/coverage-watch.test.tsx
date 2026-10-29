/**
 * Start again when the library catches up (S47, R3.4, ADR 0018): after a 422 no-coverage the run
 * screen opens one event stream; a coverage_added for a configuration the drill reaches clears the
 * refusal and says what was added, one for another configuration changes nothing, and the stream
 * closes once the refusal leaves the screen.
 */
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fixtureConfigs } from "../../src/fixtures/study.js";
import { fixtureDrill, fixturePracticeSession } from "../../src/fixtures/trainer.js";
import { openBrowserEvents } from "../../src/library/library-deps.js";
import { jsonResponse, problemResponse } from "../api/fake-fetch.js";
import { FakeEventStream } from "../library/render-library.js";
import { NEXT_PATH, START_PATH, renderRun } from "./render-run.js";
import { fixturePlainPrompt } from "../../src/fixtures/trainer.js";

const CONFIGS_PATH = "GET /api/v1/configs";
const EVENT = { config_id: "cfg_6_online_100", pair: "BB-BTN", flop: "Kd8s3h", build_id: "b1", scenario_count: 20 };

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

describe("R3.4 Start again on coverage_added", () => {
  it("R3.4 after a 422 no-coverage a coverage_added for a reached configuration clears the refusal and says Start again", async () => {
    const { streams, deps } = withStreams();
    renderRun({
      libraryDeps: deps,
      script: {
        [START_PATH]: [problemResponse(422, "no-coverage"), jsonResponse(201, fixturePracticeSession)],
        [CONFIGS_PATH]: [jsonResponse(200, { items: fixtureConfigs, next_cursor: null })],
        [NEXT_PATH]: [jsonResponse(200, fixturePlainPrompt)],
      },
    });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    expect(streams).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(streams).toHaveLength(1));
    expect(screen.getByTestId("coverage-watch")).toHaveTextContent("Watching the library");
    streams[0]?.open();
    // Another configuration: nothing changes.
    streams[0]?.emit("coverage_added", { ...EVENT, config_id: "cfg_9_live_13_100" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    streams[0]?.emit("coverage_added", EVENT);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByTestId("start-note")).toHaveTextContent("The library just added Big blind versus button at Online, 6 players, 100bb deep. Start again.");
    // The refusal left the screen, so the stream is closed; Start works as before.
    await waitFor(() => expect(streams[0]?.closed).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    await screen.findByRole("group", { name: "Actions" });
  });

  it("R3.4 without a refusal the run screen opens no stream", async () => {
    const { streams, deps } = withStreams();
    renderRun({ libraryDeps: { ...deps, openEvents: deps.openEvents }, script: { [NEXT_PATH]: [jsonResponse(200, fixturePlainPrompt)] } });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    await screen.findByRole("group", { name: "Actions" });
    expect(streams).toHaveLength(0);
    expect(typeof openBrowserEvents).toBe("function");
  });
});
