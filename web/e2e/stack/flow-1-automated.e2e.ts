/**
 * Flow 1 (A7 section 5): an automated training session moves the rating (S32, R4.10, R4.12, O-272,
 * O-284, O-324, O-326, ADR 0018). Part of the stack project, so just e2e and the CI e2e job run it;
 * the file name sorts it before flows 2 to 6, and the project runs one worker in file order, so it
 * meets the e2e owner before any other flow trains. Without E2E_OWNER_EMAIL and
 * E2E_OWNER_PASSWORD it skips like the other stack flows.
 *
 * Mechanism, over the compose dev stack with the fixture library and the learning seed that
 * `just fixture-learning` writes in infra/compose/e2e.mjs (O-324: a schedule card with two Good
 * reviews for every catalog class, so the first block is rated, not a worked example): sign in and
 * see the home rating card read Unrated; open /train from the main navigation and start with the
 * defaults (every covered configuration, standard grouping, Mixed-frequency mode off; no seed, so
 * the session is rated); play five decisions, each an action that submits at once (a click or the
 * 1 key) with nothing revealed before it and no confidence field sent (O-345, O-373); end the
 * session through E and the confirm; the recap lists at least one rated
 * decision; back home the rating card shows a whole-number rating with plus or minus RD.
 *
 * When SCREENSHOT_DIR is set the flow captures the start panel, the first prompt, the recap and the
 * updated rating card at the desktop width in the light theme, merged into the manifest with
 * session S32 and source stack.
 */
import { expect, test } from "@playwright/test";

import { endAndReadRecap, expectRatedCard, expectUnratedCard, FLOW_1_DECISIONS, playDecisions, startTraining, type Flow1Shooter } from "../support/flow-1.js";
import { ownerCredentials } from "../support/owner-credentials.js";
import { mergeShotManifest, shotDirectory, type ShotRecord } from "../support/shot-manifest.js";
import { capture, DESKTOP, prepareShotPage } from "../support/shots.js";
import { signInOnce } from "../support/sign-in-flow.js";

const credentials = ownerCredentials(process.env);
const SKIP_REASON = "Flow 1 needs E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD; just e2e creates the owner and sets both";
const SHOTS = (process.env["SCREENSHOT_DIR"] ?? "") !== "";
const OUT_DIR = shotDirectory();
const SESSION = "S32";
const SOURCE = "stack";
const THEME = "light";
const FLOW_TIMEOUT_MS = 180_000;
const MIN_RATED = 1;

const CRITERIA = {
  start: "R4.10 flow 1 on the stack: automated start with every covered configuration, grouping and RNG from the session defaults, no seed (O-325)",
  session: "R4.10 flow 1 on the stack: a rated block's prompt with its banner (family, track, hand 1 of 3) (O-272)",
  recap: "R4.10 flow 1 on the stack: recap with rated decisions and the rating change per track (O-325)",
  rating: "R4.12 flow 1 on the stack: the home rating card shows a rating with plus or minus RD after the session (O-326)",
} as const;

const records: ShotRecord[] = [];

test.afterAll(() => {
  if (SHOTS) mergeShotManifest(OUT_DIR, SESSION, records);
});

test("R4.10 R4.12 flow 1: five automated decisions on the stack give the fresh owner a rating", async ({ page }) => {
  test.skip(credentials === undefined, SKIP_REASON);
  test.setTimeout(FLOW_TIMEOUT_MS);
  if (credentials === undefined) return;
  await prepareShotPage(page, THEME, DESKTOP);
  const shot: Flow1Shooter = async (screen, criterion) => {
    if (!SHOTS) return;
    records.push(await capture(page, page, OUT_DIR, { screen, theme: THEME, viewport: DESKTOP, criterion, source: SOURCE }));
  };

  await signInOnce(page, credentials);
  await expectUnratedCard(page);

  await startTraining(page, shot, CRITERIA.start);
  await expect(page.getByTestId("block-rating"), "the seeded owner's first block is rated (O-324)").toHaveText("Rated block: first attempts count toward your rating");
  await playDecisions(page, FLOW_1_DECISIONS, shot, CRITERIA.session);

  const rated = await endAndReadRecap(page);
  expect(rated, "the recap lists at least one rated decision").toBeGreaterThanOrEqual(MIN_RATED);
  await expect(page.getByRole("table", { name: "Rating by track" })).toBeVisible();
  await shot("flow1-recap", CRITERIA.recap);

  await expectRatedCard(page);
  await shot("flow1-rating-card", CRITERIA.rating);
});
