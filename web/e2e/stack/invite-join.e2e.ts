/**
 * The invite flow through Caddy against the real api and database (S42, R3.5, R3.13, O-349), part
 * of the stack project. The per-run owner (an admin, O-263, O-294) signs in, creates an invite for
 * a fresh email in /settings/invites and reads the link from the dialog; a second browser context
 * with no session opens it, joins with a name and a password, and lands on the home shell as the
 * new member; the same link then reads invalid (single use). Skipped without the owner variables,
 * like the sign-in flow.
 */
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { ownerCredentials } from "../support/owner-credentials.js";
import { signInOnce } from "../support/sign-in-flow.js";

const credentials = ownerCredentials(process.env);
const SKIP_REASON = "R3.5 needs E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD; just e2e creates the owner and sets both";
const INVALID_TEXT = "This invite link is not valid.";

test("R3.5 R3.13 an admin's invite link joins a new member once, then reads invalid", async ({ page, browser, baseURL }) => {
  test.skip(credentials === undefined, SKIP_REASON);
  if (credentials === undefined) return;
  const email = `invitee-${randomUUID()}@example.com`;

  await signInOnce(page, credentials);
  await page.goto("/settings/invites");
  await page.getByLabel("Email to invite").fill(email);
  await page.getByRole("button", { name: "Create invite" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite link" });
  const link = await dialog.getByLabel("Join link").inputValue();
  expect(new URL(link).pathname).toBe("/join");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("list", { name: "Recent invites" })).toContainText(email);

  const joiner = await browser.newContext({ ...(baseURL === undefined ? {} : { baseURL }), ignoreHTTPSErrors: true });
  try {
    const joinPage = await joiner.newPage();
    await joinPage.goto(link);
    await expect(joinPage.getByTestId("email-chip")).toHaveText(email);
    await joinPage.getByLabel("Name").fill("Invited Member");
    // A boxed step with a fixed title, so the report never shows the fill call with its value (O-263).
    await test.step(
      "fill the new password",
      async () => {
        await joinPage.getByLabel("Password", { exact: true }).fill(`stack-${randomUUID()}`);
      },
      { box: true },
    );
    await joinPage.getByRole("button", { name: "Create account" }).click();
    await expect(joinPage.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(joinPage.getByTestId("shell")).toContainText(email);

    await joinPage.goto(link);
    await expect(joinPage.getByRole("alert")).toContainText(INVALID_TEXT);
  } finally {
    await joiner.close();
  }
});
