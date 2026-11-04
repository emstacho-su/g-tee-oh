/**
 * The admin pages of /library (Builder state at /library/builder, Builder settings at
 * /library/settings, S40 O-406) and the builder schedule on /settings (S28, R3.5, O-290, O-292,
 * O-295, O-296, O-299, A9 section 4), against the mocked api of e2e/support/mock-library.ts.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CSRF_HEADER } from "../../src/api/index.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import { FIXTURE_ONLINE_STAKE_ID } from "../../src/fixtures/study.js";
import { jsonBody, libraryPath, renderLibrary } from "./render-library.js";

const BUILDER_PATH = "/api/v1/admin/builder";
const SETTINGS_PATH = "/api/v1/admin/builder/settings";

function item(term: string): HTMLElement {
  const label = screen.getByText(term, { selector: "dt" });
  const box = label.parentElement;
  if (box === null) throw new Error(`no item for ${term}`);
  return box;
}

describe("R3.5 builder health", () => {
  it("R3.5 an admin sees state, queue depth, flops per day, storage against budget and the labeled placeholders", async () => {
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "builder"));

    expect(await screen.findByTestId("builder-state")).toHaveTextContent("Running");
    expect(item("Queue depth")).toHaveTextContent("3 queued, 1 running, 0 failed, 1 waiting on budget");
    expect(item("Flops per day")).toHaveTextContent("12 (last 24 hours)");
    expect(item("Storage against budget")).toHaveTextContent("150.0 GB of 650.0 GB (builder default), 23.1%");
    // Placeholders in user words, no session ids or developer words (S47 critic G4).
    expect(item("Last backup")).toHaveTextContent("Not tracked yet: backups start with the production deploy");
    expect(item("Explanation spend this month")).toHaveTextContent("Not tracked yet: starts with written explanations");
  });

  it("R3.5 a member sees one line and the page never asks for the builder status (O-290)", async () => {
    const { sent } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "builder"), { admin: false });

    expect(await screen.findByText("Builder health and controls are for admins.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pause the builder/ })).not.toBeInTheDocument();
    expect(sent("GET", BUILDER_PATH)).toEqual([]);
  });

  it("R3.5 pause then resume: each sends the CSRF token and a key, and the state shown is the answer's", async () => {
    const user = userEvent.setup();
    const { sent } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "builder"));
    await screen.findByTestId("builder-state");

    await user.click(screen.getByRole("button", { name: "Pause the builder" }));
    await waitFor(() => expect(screen.getByTestId("builder-state")).toHaveTextContent("Paused"));
    await user.click(screen.getByRole("button", { name: "Resume the builder" }));
    await waitFor(() => expect(screen.getByTestId("builder-state")).toHaveTextContent("Running"));

    const [pause] = sent("POST", `${BUILDER_PATH}/pause`);
    const [resume] = sent("POST", `${BUILDER_PATH}/resume`);
    expect(pause?.headers[CSRF_HEADER]).toBe(FIXTURE_CSRF_TOKEN);
    expect(pause?.headers["idempotency-key"]).toBe("test-key-1");
    expect(resume?.headers["idempotency-key"]).toBe("test-key-2");
  });

  it("R3.5 a builder_state event updates the state shown, but never over a stored pause (O-295)", async () => {
    const user = userEvent.setup();
    const { streams } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "builder"));
    await screen.findByTestId("builder-state");

    streams[0]?.emit("builder_state", { state: "throttled", reason: "memory above the cap" });
    await waitFor(() => expect(screen.getByTestId("builder-state")).toHaveTextContent("Throttled"));
    expect(item("Builder state")).toHaveTextContent("memory above the cap");

    await user.click(screen.getByRole("button", { name: "Pause the builder" }));
    await waitFor(() => expect(screen.getByTestId("builder-state")).toHaveTextContent("Paused"));
    streams[0]?.emit("builder_state", { state: "running", reason: "" });
    streams[0]?.emit("builder_state", { state: "exploded", reason: "" });
    // The query cache notifies on a later tick; wait one before checking that nothing changed.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("builder-state")).toHaveTextContent("Paused");
  });

  it("R3.5 a build_progress event shows the build in progress", async () => {
    const { streams } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "builder"));
    await screen.findByTestId("builder-state");

    streams[0]?.emit("build_progress", { job_id: "j1", line: "r250.c", iteration: 120, exploitability: [0.41, 0.38] });

    expect(screen.getByText("Current build: Line r250.c, iteration 120, exploitability 0.41% and 0.38% of the pot")).toBeInTheDocument();
  });

  it("R3.5 a refused pause shows a fixed message", async () => {
    const user = userEvent.setup();
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "builder"), {
      override: (request) =>
        request.path === `${BUILDER_PATH}/pause` ? jsonBody(409, { status: 409, detail: "server detail text" }, "application/problem+json") : undefined,
    });
    await screen.findByTestId("builder-state");

    await user.click(screen.getByRole("button", { name: "Pause the builder" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Another change is still being saved. Try again in a moment.");
  });

  it("R3.5 a failed status read shows an alert with a retry", async () => {
    const user = userEvent.setup();
    let fail = true;
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "builder"), {
      override: (request) => (request.path === BUILDER_PATH && fail ? jsonBody(500, { status: 500 }) : undefined),
    });

    expect(await screen.findByText("The builder status could not be loaded.")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("builder-state")).toHaveTextContent("Running");
  });
});

describe("R3.5 builder settings round trip", () => {
  it("R3.5 a save sends only the changed keys and the fields then show the stored values", async () => {
    const user = userEvent.setup();
    const { sent } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "settings"));
    const share = await screen.findByRole("spinbutton", { name: "CPU share" });
    expect(share).toHaveValue(0.6);
    const budget = screen.getByRole("spinbutton", { name: "Storage budget (GB)" });
    expect(budget).toHaveValue(650);
    expect(screen.getByText(/Now 650 \(builder default\)/)).toBeInTheDocument();

    await user.clear(share);
    await user.type(share, "0.75");
    await user.clear(budget);
    await user.type(budget, "500");
    await user.click(screen.getByRole("button", { name: "Save builder settings" }));

    await screen.findByText("Saved. The builder reads the new settings before its next job.");
    const [patch] = sent("PATCH", SETTINGS_PATH);
    expect(patch?.body).toEqual({ cpu_share: 0.75, budget_bytes: 500_000_000_000 });
    expect(patch?.headers[CSRF_HEADER]).toBe(FIXTURE_CSRF_TOKEN);
    expect(screen.getByRole("spinbutton", { name: "CPU share" })).toHaveValue(0.75);
    expect(screen.getByText(/^Now 500\. Use a whole number of gigabytes/)).toBeInTheDocument();
    // The builder state page reads the same cached status, so it shows the stored budget (S40, O-406).
    await user.click(within(screen.getByRole("navigation", { name: "Library sections" })).getByRole("link", { name: "Builder state" }));
    await screen.findByTestId("builder-state");
    expect(item("Storage against budget")).toHaveTextContent("150.0 GB of 500.0 GB, 30.0%");
  });

  it("R3.5 an out-of-range value is named and nothing is sent; an unchanged form sends nothing", async () => {
    const user = userEvent.setup();
    const { sent } = renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "settings"));
    const runouts = await screen.findByRole("spinbutton", { name: "Runouts per flop" });

    await user.click(screen.getByRole("button", { name: "Save builder settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing changed.");

    await user.clear(runouts);
    await user.type(runouts, "5000");
    await user.click(screen.getByRole("button", { name: "Save builder settings" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Runouts per flop: a whole number from 1 to 2352");
    expect(runouts).toHaveAttribute("aria-invalid", "true");
    expect(sent("PATCH", SETTINGS_PATH)).toEqual([]);
  });

  it("R3.5 a refused save shows a fixed message and keeps the edit", async () => {
    const user = userEvent.setup();
    renderLibrary(libraryPath(FIXTURE_ONLINE_STAKE_ID, undefined, "settings"), {
      override: (request) =>
        request.path === SETTINGS_PATH ? jsonBody(422, { status: 422, detail: "server detail text" }, "application/problem+json") : undefined,
    });
    const seconds = await screen.findByRole("spinbutton", { name: "Seconds per line" });

    await user.clear(seconds);
    await user.type(seconds, "900");
    await user.click(screen.getByRole("button", { name: "Save builder settings" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The api refused these values. Check them and try again.");
    expect(seconds).toHaveValue(900);
  });
});

describe("R3.5 /settings builder schedule", () => {
  it("R3.5 the schedule round trip sends the whole overnight window and shows it stored", async () => {
    const user = userEvent.setup();
    const { sent } = renderLibrary("/settings/builder-schedule");
    const form = await screen.findByRole("form", { name: "Builder schedule" });
    expect(within(form).getByText("Now 00:00 to 07:00 at UTC offset 0 minutes, CPU share 1 (builder default)")).toBeInTheDocument();

    const end = within(form).getByRole("spinbutton", { name: "Window ends (hour)" });
    await user.clear(end);
    await user.type(end, "6");
    const offset = within(form).getByRole("spinbutton", { name: "UTC offset (minutes)" });
    await user.clear(offset);
    await user.type(offset, "-300");
    await user.click(within(form).getByRole("button", { name: "Save the schedule" }));

    await within(form).findByText("Saved. The builder reads the new settings before its next job.");
    expect(sent("PATCH", SETTINGS_PATH)[0]?.body).toEqual({
      overnight: { start_hour: 0, end_hour: 6, utc_offset_minutes: -300, cpu_share: 1 },
    });
    expect(within(form).getByText("Now 00:00 to 06:00 at UTC offset -300 minutes, CPU share 1")).toBeInTheDocument();
  });

  it("R3.5 an invalid hour is named and nothing is sent", async () => {
    const user = userEvent.setup();
    const { sent } = renderLibrary("/settings/builder-schedule");
    const start = await screen.findByRole("spinbutton", { name: "Window starts (hour)" });

    await user.clear(start);
    await user.type(start, "24");
    await user.click(screen.getByRole("button", { name: "Save the schedule" }));

    // Scoped to the form: /settings has other sections with their own alerts (S32).
    const form = screen.getByRole("form", { name: "Builder schedule" });
    expect(await within(form).findByRole("alert")).toHaveTextContent("Window starts (hour): a whole hour from 0 to 23");
    expect(sent("PATCH", SETTINGS_PATH)).toEqual([]);
  });

  it("R3.5 a failed settings read shows an alert with a retry", async () => {
    const user = userEvent.setup();
    let fail = true;
    renderLibrary("/settings/builder-schedule", {
      override: (request) => (request.path === BUILDER_PATH && fail ? jsonBody(500, { status: 500 }) : undefined),
    });

    expect(await screen.findByText("The builder settings could not be loaded.")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("form", { name: "Builder schedule" })).toBeInTheDocument();
  });

  it("R3.5 a member sees that the schedule is for admins and no admin read is made (O-290)", async () => {
    const { sent } = renderLibrary("/settings/builder-schedule", { admin: false });

    expect(await screen.findByText("The builder schedule is for admins.")).toBeInTheDocument();
    expect(sent("GET", BUILDER_PATH)).toEqual([]);
  });
});
