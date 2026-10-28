/**
 * Flow 1 against the mocked api (S32, R4.10, R4.12, O-264, O-324, O-326): the same steps as
 * e2e/stack/flow-1-automated.e2e.ts on the harness build under vite preview, with /api/v1 answered
 * by support/mock-app.ts. The learner starts fresh (no rating); the mocked automated session serves
 * a rated block, then a worked example (support/mock-automated.ts), and ending it with rated
 * decisions moves the mocked learner to seasoned, so the home rating card, refetched because the
 * end invalidated every progress read, shows a rating with its deviation.
 */
import { expect, test } from "@playwright/test";

import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { endAndReadRecap, expectRatedCard, expectUnratedCard, FLOW_1_DECISIONS, playDecisions, startTraining } from "../support/flow-1.js";
import { installAppMockApi } from "../support/mock-app.js";
import { signIn } from "../support/sign-in-flow.js";

const OWNER = { email: FIXTURE_USER_EMAIL, password: "any-non-empty-password" };

test("R4.10 R4.12 mock flow 1: an automated session of five decisions turns an unrated card into a rating", async ({ page }) => {
  await installAppMockApi(page, { learner: "fresh" });
  await signIn(page, OWNER);
  await expectUnratedCard(page);

  await startTraining(page);
  await expect(page.getByTestId("block-hand")).toHaveText("Hand 1 of 3 in this block");
  await playDecisions(page, FLOW_1_DECISIONS);
  // Decisions 4 and 5 are the second block, a worked example in the mock.
  await expect(page.getByTestId("block-rating")).toHaveText("Worked example: panels visible, not rated");

  const rated = await endAndReadRecap(page);
  expect(rated, "the rated block's three decisions were rated").toBe(3);
  // The recap lists each rated track as a card in the "Rating by track" list (S38 restyle).
  await expect(page.getByRole("list", { name: "Rating by track" })).toBeVisible();

  await expectRatedCard(page);
});
