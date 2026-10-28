/**
 * Two-step sign-in and the invite join flow against the mocked api (S42, R3.13, R3.5, O-349),
 * part of the mock project: the harness build under `vite preview` with every /api/v1 request
 * answered by e2e/support/mock-api.ts. The admin creates an invite in /settings/invites and reads
 * the link from the dialog; a second page, signed out with its own mock, opens the link, joins
 * with a name and a password, lands home as the new member, and the used link then reads invalid.
 */
import { expect, test } from "@playwright/test";

import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { installAppMockApi } from "../support/mock-app.js";
import { INSPECT_PATH, JOIN_PATH, MOCK_INVITE_EMAIL, MOCK_INVITE_TOKEN } from "../support/mock-join.js";
import { LOGIN_PATH } from "../support/mock-api.js";
import { signIn } from "../support/sign-in-flow.js";

const OWNER = { email: FIXTURE_USER_EMAIL, password: "any-non-empty-password" };
const NEW_PASSWORD = "plum orbit lantern seventy";
const INVALID_TEXT = "This invite link is not valid.";

test("R3.13 mock: step 1 of sign-in sends no request; step 2 sends the one login", async ({ page }) => {
  const api = await installAppMockApi(page);
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  expect(api.requests().some((request) => request.path === LOGIN_PATH)).toBe(false);
  await expect(page.getByTestId("email-chip")).toHaveText(OWNER.email);
});

test("R3.5 R3.13 mock: an admin creates an invite, the link joins once, then reads invalid", async ({ page, context }) => {
  await installAppMockApi(page);
  await signIn(page, OWNER);
  await page.goto("/settings/invites");
  await page.getByLabel("Email to invite").fill(MOCK_INVITE_EMAIL);
  await page.getByRole("button", { name: "Create invite" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite link" });
  const link = await dialog.getByLabel("Join link").inputValue();
  expect(link.endsWith(`/join#${MOCK_INVITE_TOKEN}`)).toBe(true);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Recent invites" })).toContainText(MOCK_INVITE_EMAIL);

  const joiner = await context.browser()?.newContext({ baseURL: "http://localhost:4173" });
  if (joiner === undefined) throw new Error("no browser to open a second context");
  const joinPage = await joiner.newPage();
  const joinApi = await installAppMockApi(joinPage, { admin: false });
  await joinPage.goto(link);
  await expect(joinPage.getByTestId("email-chip")).toHaveText(MOCK_INVITE_EMAIL);
  await expect(joinPage).toHaveURL((url) => url.hash === "");
  await joinPage.getByLabel("Name").fill("Sam Rivera");
  await joinPage.getByLabel("Password", { exact: true }).fill(NEW_PASSWORD);
  await expect(joinPage.getByTestId("strength-meter")).not.toHaveAttribute("data-score", "0");
  await joinPage.getByRole("button", { name: "Create account" }).click();
  await expect(joinPage.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(joinPage.getByTestId("shell")).toContainText(MOCK_INVITE_EMAIL);
  const joins = joinApi.requests().filter((request) => request.path === JOIN_PATH);
  expect(joins).toHaveLength(1);

  await joinPage.goto(link);
  await expect(joinPage.getByRole("alert")).toContainText(INVALID_TEXT);
  expect(joinApi.requests().filter((request) => request.path === INSPECT_PATH)).toHaveLength(2);
  await joiner.close();
});
