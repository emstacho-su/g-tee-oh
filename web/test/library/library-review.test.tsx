/**
 * Behaviour fixed after the PR #28 review (S28, R3.4, R3.5, O-232, O-297): one Idempotency-Key
 * per user intent, no answer or live note leaking across a pair or configuration change, the
 * build progress line clearing, a 403 from an admin call rechecking the session, and the event
 * stream giving up after a named number of consecutive errors.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FIXTURE_QUEUE_PAIR, FIXTURE_REQUESTED_FLOP } from "../../src/fixtures/library.js";
import { FIXTURE_ONLINE_STAKE_ID, FIXTURE_STUDY_CONFIG_ID } from "../../src/fixtures/study.js";
import { MAX_CONSECUTIVE_STREAM_ERRORS } from "../../src/library/use-server-events.js";
import { jsonBody, libraryPath, renderLibrary } from "./render-library.js";

const REQUESTS_PATH = "/api/v1/coverage/requests";
const BUILDER_PATH = "/api/v1/admin/builder";
const SETTINGS_PATH = "/api/v1/admin/builder/settings";
const PAUSE_PATH = `${BUILDER_PATH}/pause`;

function unavailable(): Response {
  return jsonBody(503, { type: "urn:g-tee-oh:problem:unavailable", title: "t", status: 503 }, "application/problem+json");
}

describe("R3.4 R3.5 one Idempotency-Key per intent (O-232)", () => {
  it("R3.4 two rapid clicks on a gap request send one request", async () => {
    const { sent } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_QUEUE_PAIR));
    const button = await screen.findByRole("button", { name: `Request ${FIXTURE_REQUESTED_FLOP}` });

    fireEvent.click(button);
    fireEvent.click(button);

    await screen.findByTestId("gap-request-result");
    expect(sent("POST", REQUESTS_PATH).map((request) => request.headers["idempotency-key"])).toEqual(["test-key-1"]);
  });

  it("R3.4 retrying the same request after a failure reuses its key; another request gets a new one", async () => {
    const user = userEvent.setup();
    let failures = 1;
    const { sent } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_QUEUE_PAIR), {
      override: (request) => {
        if (request.path !== REQUESTS_PATH || failures === 0) return undefined;
        failures -= 1;
        return unavailable();
      },
    });
    const button = await screen.findByRole("button", { name: `Request ${FIXTURE_REQUESTED_FLOP}` });

    await user.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("busy right now");
    await user.click(button);
    await screen.findByTestId("gap-request-result");
    await user.click(screen.getByRole("button", { name: "Request Kd8s3h" }));
    await waitFor(() => expect(sent("POST", REQUESTS_PATH)).toHaveLength(3));

    expect(sent("POST", REQUESTS_PATH).map((request) => request.headers["idempotency-key"])).toEqual(["test-key-1", "test-key-1", "test-key-2"]);
  });

  it("R3.5 two rapid clicks on Pause send one request", async () => {
    const { sent } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "builder"));
    const pause = await screen.findByRole("button", { name: "Pause the builder" });

    fireEvent.click(pause);
    fireEvent.click(pause);

    await waitFor(() => expect(screen.getByTestId("builder-state")).toHaveTextContent("Paused"));
    expect(sent("POST", PAUSE_PATH)).toHaveLength(1);
  });

  it("R3.5 two rapid saves send one settings PATCH", async () => {
    const { sent } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "settings"));
    const share = await screen.findByRole("spinbutton", { name: "CPU share" });
    fireEvent.change(share, { target: { value: "0.8" } });
    const save = screen.getByRole("button", { name: "Save builder settings" });

    fireEvent.click(save);
    fireEvent.click(save);

    await screen.findByText("Saved. The builder reads the new settings before its next job.");
    expect(sent("PATCH", SETTINGS_PATH).map((request) => request.headers["idempotency-key"])).toEqual(["test-key-1"]);
  });
});

describe("R3.4 nothing leaks across a selection change (O-297)", () => {
  it("R3.4 a newly selected pair starts with an empty flop field and no earlier answer", async () => {
    const user = userEvent.setup();
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_QUEUE_PAIR));
    await user.type(await screen.findByRole("textbox", { name: "Flop" }), "Ah7d2c");
    await user.click(screen.getByRole("button", { name: "Request this flop" }));
    await screen.findByTestId("gap-request-result");

    await user.click(screen.getByRole("button", { name: /^Small blind versus button/ }));

    await screen.findByRole("heading", { name: "Small blind versus button at Online, 6 players, 100bb deep" });
    expect(screen.queryByTestId("gap-request-result")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Flop" })).toHaveValue("");
  });

  it("R3.4 the live coverage note clears when the configuration changes", async () => {
    const user = userEvent.setup();
    const { streams } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, FIXTURE_QUEUE_PAIR));
    await screen.findByRole("table", { name: "Build queue for this pair" });
    streams[0]?.emit("coverage_added", { config_id: FIXTURE_STUDY_CONFIG_ID, pair: FIXTURE_QUEUE_PAIR, flop: "Kd8s3h", build_id: "b1", scenario_count: 20 });
    expect(screen.getByTestId("live-coverage")).toHaveTextContent("New coverage");

    await user.selectOptions(screen.getByLabelText("Depth"), "200bb");

    await waitFor(() => expect(screen.getByTestId("live-coverage")).toHaveTextContent(""));
  });
});

describe("R3.5 the build progress line clears", () => {
  const progress = { job_id: "j1", line: "r250.c", iteration: 120, exploitability: [0.41, 0.38] };
  const progressText = /^Current build:/;

  it("R3.5 a coverage_added for any configuration ends the shown build", async () => {
    const { streams } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "builder"));
    await screen.findByTestId("builder-state");
    streams[0]?.emit("build_progress", progress);
    expect(screen.getByText(progressText)).toBeInTheDocument();

    streams[0]?.emit("coverage_added", { config_id: "cfg_9_live_13_100", pair: "BB-BTN", flop: "Kd8s3h", build_id: "b1", scenario_count: 20 });

    expect(screen.queryByText(progressText)).not.toBeInTheDocument();
  });

  it.each(["idle", "paused"])("R3.5 the builder reporting %s ends the shown build", async (state) => {
    const { streams } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "builder"));
    await screen.findByTestId("builder-state");
    streams[0]?.emit("build_progress", progress);

    streams[0]?.emit("builder_state", { state, reason: "" });

    expect(screen.queryByText(progressText)).not.toBeInTheDocument();
  });
});

describe("R3.5 security follow-ups (O-290, O-297)", () => {
  it("R3.5 a 403 from an admin call rechecks the session, so a revoked admin loses the controls", async () => {
    // The flag is revoked server-side between the status read and the pause.
    let admin = true;
    const { sent } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "builder"), {
      isAdminNow: () => admin,
      override: (request) => {
        if (request.path !== PAUSE_PATH) return undefined;
        admin = false;
        return jsonBody(403, { type: "urn:g-tee-oh:problem:forbidden", title: "t", status: 403 }, "application/problem+json");
      },
    });
    const mesBefore = sent("GET", "/api/v1/me").length;
    fireEvent.click(await screen.findByRole("button", { name: "Pause the builder" }));

    expect(await screen.findByText("Builder health and controls are for admins.")).toBeInTheDocument();
    expect(sent("GET", "/api/v1/me").length).toBeGreaterThan(mesBefore);
  });

  it(`R3.4 the stream closes after ${String(MAX_CONSECUTIVE_STREAM_ERRORS)} consecutive errors and offers Reconnect; an open resets the count`, async () => {
    const { streams } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID));
    await screen.findByRole("list", { name: "Pairs" });
    const stream = streams[0];
    if (stream === undefined) throw new Error("no stream");

    for (let count = 1; count < MAX_CONSECUTIVE_STREAM_ERRORS; count += 1) stream.fail(false);
    stream.open();
    for (let count = 1; count < MAX_CONSECUTIVE_STREAM_ERRORS; count += 1) stream.fail(false);
    expect(stream.closed).toBe(false);
    expect(screen.getByTestId("live-status")).toHaveTextContent("Connecting to live updates.");

    stream.fail(false);

    expect(stream.closed).toBe(true);
    expect(screen.getByTestId("live-status")).toHaveTextContent("Live updates stopped.");
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
  });
});
