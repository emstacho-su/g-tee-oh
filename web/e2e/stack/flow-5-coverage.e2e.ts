/**
 * Flow 5 (A7 section 5): request coverage for an uncovered spot and see the queue position;
 * nothing waits on a solve (S28, R3.4, R3.5, ADR 0018, O-240, O-293, O-294, O-298). Part of the
 * stack project, so just e2e and the CI e2e job run it with the e2e owner, who is an admin
 * (O-294); without the owner's credentials it skips like sign-in.e2e.ts.
 *
 * Mechanism, over the compose dev stack with the fixture library and the queue that
 * `just fixture-queue` seeds (three queued builds for cfg_6_online_100 BB-BTN, no builder
 * running): sign in, open /library from the main navigation and see the live update stream open
 * through Caddy. At live 9-handed 1/3 150 bb, which the fixture library does not hold, request
 * the first pair's preflop: recorded, no queue position (a preflop gap has no build job). At
 * online 6-max 100 bb, select BB-BTN and request the last queued flop: queued at position 1, and
 * the queue table shows it first. Each answer must arrive within ANSWER_LIMIT_MS. Then pause and
 * resume the builder (the state shown follows the answers; with no builder running, resume shows
 * the unknown state, O-295) and round-trip the CPU share through the settings form and a reload.
 */
import { test } from "@playwright/test";

import { chooseConfig, expectLiveUpdates, openLibrary, pauseThenResume, requestQueuedFlop, requestUncoveredPreflop, settingsRoundTrip } from "../support/flow-5.js";
import { ownerCredentials } from "../support/owner-credentials.js";
import { DESKTOP } from "../support/shots.js";
import { signIn } from "../support/sign-in-flow.js";

const credentials = ownerCredentials(process.env);
const SKIP_REASON = "R3.4 flow 5 needs E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD; just e2e creates the admin owner and sets both";
const FLOW_TIMEOUT_MS = 120_000;
/** Seeded by scripts/fixture-queue.mjs: the lowest-priority queued flop of cfg_6_online_100 BB-BTN. */
const QUEUED_PAIR = "BB-BTN";
const QUEUED_FLOP = "Th6c2s";
const NEW_CPU_SHARE = "0.7";

test("R3.4 R3.5 flow 5: a gap request answers at once with its queue position; pause, resume and a settings round trip", async ({ page }) => {
  test.skip(credentials === undefined, SKIP_REASON);
  if (credentials === undefined) return;
  test.setTimeout(FLOW_TIMEOUT_MS);
  await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });

  await signIn(page, credentials);
  await openLibrary(page);
  await expectLiveUpdates(page);

  await chooseConfig(page, { format: "live", tableSize: "9", stakeLabel: "1/3", depthLabel: "150bb" });
  await requestUncoveredPreflop(page);

  await chooseConfig(page, { format: "online", tableSize: "6", stakeLabel: "online", depthLabel: "100bb" });
  await requestQueuedFlop(page, QUEUED_PAIR, QUEUED_FLOP);

  await pauseThenResume(page);
  await settingsRoundTrip(page, NEW_CPU_SHARE);
});
