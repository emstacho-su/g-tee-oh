/**
 * The sign-in flow both Playwright projects drive (R3.13): the stack project through Caddy
 * against the real api, the mock project against vite preview with the mocked api. Keeping the
 * steps and selectors in one place means the two projects prove the same thing.
 *
 * The selectors are the app's accessible names (Lane A, S24): the login page's h1 "Sign in",
 * inputs labeled "Email" and "Password" and the "Sign in" button; the home shell's h1 "Home",
 * the nav named "Main", the signed-in email in the header and the "Sign out" button; all inside
 * <div data-testid="shell">. A signed-out visit to / redirects to /login (with a redirect query
 * back to /), and a sign-in lands on /.
 */
import { expect, test, type Page } from "@playwright/test";

import type { OwnerCredentials } from "./owner-credentials.js";

export const HOME_PATH = "/";
export const LOGIN_PATH = "/login";
export const PASSWORD_STEP_TITLE = "fill the password";
const SHELL_TEST_ID = "shell";

function onPath(path: string): (url: URL) => boolean {
  return (url) => url.pathname === path;
}

/** Visits / signed out and expects the redirect to the login page. */
export async function expectRedirectToLogin(page: Page): Promise<void> {
  await page.goto(HOME_PATH);
  await expect(page).toHaveURL(onPath(LOGIN_PATH));
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
}

/** Fills the login form and submits it; the caller asserts where that leads. */
export async function submitLogin(page: Page, credentials: OwnerCredentials): Promise<void> {
  await page.getByLabel("Email").fill(credentials.email);
  // A boxed step with a fixed title: the Playwright report and the list reporter show only
  // "fill the password", never the fill call with its value (O-263).
  await test.step(
    PASSWORD_STEP_TITLE,
    async () => {
      await page.getByLabel("Password").fill(credentials.password);
    },
    { box: true },
  );
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Expects the home shell for the signed-in `email`. */
export async function expectHomeShell(page: Page, email: string): Promise<void> {
  await expect(page).toHaveURL(onPath(HOME_PATH));
  const shell = page.getByTestId(SHELL_TEST_ID);
  await expect(shell.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(shell.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(shell).toContainText(email);
}

/** Presses Sign out and expects the login page. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(onPath(LOGIN_PATH));
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
}

/** The whole flow: redirect to /login, sign in, land on the home shell. */
export async function signIn(page: Page, credentials: OwnerCredentials): Promise<void> {
  await expectRedirectToLogin(page);
  await submitLogin(page, credentials);
  await expectHomeShell(page, credentials.email);
}
