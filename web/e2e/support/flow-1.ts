/**
 * The steps of flow 1 (A7 section 5, S32, S37, R4.10, R4.12, R3.13, O-272, O-284, O-324, O-326,
 * O-345), shared by the stack flow and its mock twin: read the home rating card, open /train from
 * the main navigation, start with the session defaults, play decisions (choosing an action submits
 * it, then the feedback, then Next), end the session through the confirm, read the recap, go home
 * and read the rating card again.
 *
 * Mechanism: every step drives the app through its visible controls and accessible names, as a
 * player would. Decisions alternate a click and the 1 key so both ways of choosing are exercised;
 * nothing is revealed before the choice, and each decision request is checked to carry no
 * confidence field (the tap was retired, O-345, O-373).
 */
import { expect, type Page } from "@playwright/test";

/** The flow's decisions (A7 section 5: five decisions). */
export const FLOW_1_DECISIONS = 5;
/** A decision is graded from the library; a cold CI runner gets a generous bound. */
const FEEDBACK_TIMEOUT_MS = 15_000;
/** The action bar's first hotkey. */
const FIRST_ACTION_KEY = "1";
const DECISION_PATH = /\/api\/v1\/sessions\/[^/]+\/decisions$/;
const UNRATED_TEXT = "Unrated";
const WHOLE_NUMBER = /^\d+$/;

export type Flow1Shooter = (screen: string, criterion: string) => Promise<void>;

const noShot: Flow1Shooter = () => Promise.resolve();

function mainNav(page: Page) {
  return page.getByRole("navigation", { name: "Main" });
}

/** On the home screen: the rating card reads Unrated. */
export async function expectUnratedCard(page: Page): Promise<void> {
  const card = page.getByTestId("rating-card");
  await expect(card.getByTestId("rating-value")).toHaveText(UNRATED_TEXT);
}

/** Opens the home screen from the navigation and expects a rating with plus or minus RD. */
export async function expectRatedCard(page: Page): Promise<void> {
  await mainNav(page).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  const card = page.getByTestId("rating-card");
  await expect(card.getByTestId("rating-value")).toHaveText(WHOLE_NUMBER);
  await expect(card).toContainText("±");
}

/** Opens /train from the navigation and starts a session with the defaults. */
export async function startTraining(page: Page, shot: Flow1Shooter = noShot, criterion = ""): Promise<void> {
  await mainNav(page).getByRole("link", { name: "Train", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Automated training" })).toBeVisible();
  await expect(page.getByTestId("automated-start")).toBeVisible();
  await shot("flow1-start", criterion);
  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByTestId("block-banner")).toBeVisible();
}

/** Plays one decision: choosing the first action submits it; returns once the reveal shows. */
async function playOne(page: Page, step: number): Promise<void> {
  await expect(page.getByTestId("feedback-panel"), "nothing is revealed before the choice").toHaveCount(0);
  const sent = page.waitForRequest((request) => request.method() === "POST" && DECISION_PATH.test(new URL(request.url()).pathname));
  if (step % 2 === 0) await page.getByRole("group", { name: "Actions" }).getByRole("button").first().click();
  else await page.keyboard.press(FIRST_ACTION_KEY);
  // The browser may send the body as a stream Playwright cannot read back (null); the screen tests cover that case.
  const body: unknown = (await sent).postDataJSON();
  if (body !== null && typeof body === "object") expect(body, "the decision body carries no confidence field (O-373)").not.toHaveProperty("confidence");
  await expect(page.getByTestId("feedback-panel")).toBeVisible({ timeout: FEEDBACK_TIMEOUT_MS });
}

/** Plays `count` decisions, pressing N between them; the session shot is taken at the first prompt. */
export async function playDecisions(page: Page, count: number, shot: Flow1Shooter = noShot, criterion = ""): Promise<void> {
  for (let step = 0; step < count; step += 1) {
    await expect(page.getByRole("group", { name: "Actions" })).toBeVisible({ timeout: FEEDBACK_TIMEOUT_MS });
    if (step === 0) await shot("flow1-session", criterion);
    await playOne(page, step);
    if (step < count - 1) await page.keyboard.press("n");
  }
}

/** Ends the session through E and the confirm, and returns the recap's rated decisions. */
export async function endAndReadRecap(page: Page): Promise<number> {
  await page.keyboard.press("e");
  await page.getByRole("dialog", { name: "End this session?" }).getByRole("button", { name: "End session" }).click();
  const recap = page.getByTestId("training-recap");
  await expect(recap.getByRole("heading", { name: "Session recap" })).toBeVisible();
  const rated = recap.getByTestId("recap-summary").locator("dt", { hasText: "Rated decisions" }).locator("xpath=following-sibling::dd[1]");
  const text = (await rated.textContent()) ?? "";
  expect(text, "the recap names its rated decisions").toMatch(WHOLE_NUMBER);
  return Number(text);
}
