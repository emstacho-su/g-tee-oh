/**
 * Nothing on the trainer feedback screens is wider than a phone (R3.13, R3.19, R3.20,
 * R4.10): at a 390 px viewport the page never scrolls sideways (document scrollWidth at most
 * innerWidth) on the drill run's feedback, its More info dialog, an Ask answer and /train's
 * feedback. The range matrix used to keep its 520 px desktop size and pushed the page to 423 px.
 * Runs in the mock project against the harness build, so CI's e2e job checks it every run.
 */
import { expect, test, type Page } from "@playwright/test";

import { EXPLAIN_TEXT } from "../../src/explain/texts.js";
import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { FIXTURE_DRILL_ID, fixtureDrill } from "../../src/fixtures/trainer.js";
import { installAppMockApi } from "../support/mock-app.js";
import { MOCK_ASK_STATUS_HEADER } from "../support/mock-explain.js";
import { signIn } from "../support/sign-in-flow.js";

const PHONE = { width: 390, height: 844 } as const;
const OWNER = { email: FIXTURE_USER_EMAIL, password: "any-non-empty-password" };
const RUN_PATH = `/drills/${FIXTURE_DRILL_ID}/run`;
const EXPLAINER_NAME = "How Mixed-frequency mode works";
const QUESTION = "Why is raising better than calling here?";

async function expectNoSidewaysScroll(page: Page, screen: string): Promise<void> {
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(widths.scroll, `${screen}: page width ${widths.scroll} px at a ${widths.inner} px viewport`).toBeLessThanOrEqual(widths.inner);
}

async function closeExplainerIfOpen(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: EXPLAINER_NAME });
  if (await dialog.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
}

async function decide(page: Page): Promise<void> {
  const firstAction = page.getByTestId("action-bar").getByRole("button").first();
  await expect(firstAction).toBeEnabled();
  await firstAction.click();
  await expect(page.getByTestId("feedback-panel")).toBeVisible();
  await page.waitForLoadState("networkidle");
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(PHONE);
});

test("R3.13 R3.19 R3.20 the drill run's feedback, More info and an Ask answer fit a 390 px phone", async ({ page }) => {
  await page.setExtraHTTPHeaders({ [MOCK_ASK_STATUS_HEADER]: "ok" });
  await installAppMockApi(page);
  await signIn(page, OWNER);
  await page.goto(RUN_PATH);
  await expect(page.getByRole("heading", { name: fixtureDrill.name })).toBeVisible();
  await page.getByRole("button", { name: "Start session" }).click();
  await closeExplainerIfOpen(page);
  await decide(page);
  await expectNoSidewaysScroll(page, "drill run feedback");

  await page.getByRole("button", { name: EXPLAIN_TEXT.moreInfo }).click();
  const moreInfo = page.getByRole("dialog", { name: EXPLAIN_TEXT.moreInfoTitle });
  await expect(moreInfo.getByTestId("more-info-sections")).toBeVisible();
  await expectNoSidewaysScroll(page, "More info");
  await page.keyboard.press("Escape");
  await expect(moreInfo).toBeHidden();

  await page.getByTestId("ask-available").click();
  const ask = page.getByRole("dialog", { name: EXPLAIN_TEXT.askTitle });
  await ask.getByRole("textbox", { name: EXPLAIN_TEXT.questionLabel }).fill(QUESTION);
  await ask.getByRole("button", { name: EXPLAIN_TEXT.send }).click();
  await expect(ask.getByTestId("ask-answer-text")).toBeVisible();
  await expectNoSidewaysScroll(page, "Ask answer");
});

test("R4.10 /train's feedback fits a 390 px phone", async ({ page }) => {
  await installAppMockApi(page);
  await signIn(page, OWNER);
  await page.goto("/train");
  await page.getByRole("button", { name: "Start training" }).click();
  await decide(page);
  await expectNoSidewaysScroll(page, "/train feedback");
});
