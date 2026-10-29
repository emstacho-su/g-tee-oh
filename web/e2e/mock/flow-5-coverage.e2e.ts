/**
 * Flow 5 against the mocked api (S28, R3.4, R3.5, O-264, O-298): the same steps as
 * e2e/stack/flow-5-coverage.e2e.ts on the harness build under vite preview, with /api/v1 answered
 * by support/mock-app.ts and the event stream by support/mock-events.ts. It runs locally (where
 * the compose stack cannot build, PM carry-over S25) and in the CI e2e job before the stack flows.
 * The mock adds what the stack cannot show without a builder: a coverage_added event arriving
 * and being announced, and a member who sees no builder controls.
 */
import { expect, test } from "@playwright/test";

import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { FIXTURE_QUEUE_PAIR, FIXTURE_REQUESTED_FLOP } from "../../src/fixtures/library.js";
import { chooseConfig, expectLiveUpdates, openLibrary, pauseThenResume, requestQueuedFlop, requestUncoveredPreflop, settingsRoundTrip } from "../support/flow-5.js";
import { installAppMockApi } from "../support/mock-app.js";
import { emitServerEvent, installFakeEventSource } from "../support/mock-events.js";
import { signIn } from "../support/sign-in-flow.js";

const OWNER = { email: FIXTURE_USER_EMAIL, password: "any-non-empty-password" };
const ONLINE_100 = { format: "online", tableSize: "6", stakeLabel: "online", depthLabel: "100bb" } as const;

test("R3.4 R3.5 mock flow 5: a gap request answers at once with its queue position; pause, resume and a settings round trip", async ({ page }) => {
  await installFakeEventSource(page);
  await installAppMockApi(page);
  await signIn(page, OWNER);
  await openLibrary(page);
  await expectLiveUpdates(page);

  await chooseConfig(page, ONLINE_100);
  await requestUncoveredPreflop(page);
  await requestQueuedFlop(page, FIXTURE_QUEUE_PAIR, FIXTURE_REQUESTED_FLOP);

  await emitServerEvent(page, "coverage_added", {
    config_id: "cfg_6_online_100",
    pair: FIXTURE_QUEUE_PAIR,
    flop: "Kd8s3h",
    build_id: "synthetic-build",
    scenario_count: 20,
  });
  await expect(page.getByTestId("live-coverage")).toHaveText("New coverage: BB-BTN on Kd8s3h, 20 scenarios.");

  await pauseThenResume(page);
  await expect(page.getByTestId("builder-state")).toHaveText("Running");
  await settingsRoundTrip(page, "0.7");
});

test("R3.5 mock flow 5: a member sees the coverage view but no builder pages or controls (O-290, O-406)", async ({ page }) => {
  await installFakeEventSource(page);
  await installAppMockApi(page, { admin: false });
  await signIn(page, OWNER);
  await openLibrary(page);

  await chooseConfig(page, ONLINE_100);
  await expect(page.getByRole("navigation", { name: "Library sections" }).getByRole("link")).toHaveText(["Coverage"]);
  await page.goto("/library/builder");
  await expect(page.getByText("Builder health and controls are for admins.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause the builder" })).toHaveCount(0);
});
