/**
 * The sign-in flow both Playwright projects drive (R3.13): the stack project through Caddy
 * against the real api, the mock project against vite preview with the mocked api. Keeping the
 * steps and selectors in one place means the two projects prove the same thing.
 *
 * The selectors are the app's accessible names (Lane A, S24; two steps since S42): the login
 * page's h1 "Sign in", step 1's input labeled "Email" and its "Continue" button, step 2's input
 * labeled "Password", its "Sign in" button and "Use a different email"; the home shell's h1 "Home",
 * the nav named "Main", the signed-in email in the header and the "Sign out" button; all inside
 * <div data-testid="shell">. A signed-out visit to / redirects to /login (with a redirect query
 * back to /), and a sign-in lands on /.
 *
 * signInOnce is for the stack flows: the api allows five logins per address per minute (its
 * LOGIN_RATE_LIMIT_MAX) and the stack project runs every flow from one address in under a minute,
 * so the flows share one session. The first call in a worker signs in through the form and keeps
 * the context's cookies; later calls add those cookies to the new context and open /. Should the
 * kept session no longer be accepted (the login page shows), it signs in through the form again.
 */
import { expect, test, type Cookie, type Page } from "@playwright/test";

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

/**
 * Walks both sign-in steps and submits; the caller asserts where that leads. When the page is
 * already on step 2 (after a rejected attempt), it goes back to step 1 first.
 */
export async function submitLogin(page: Page, credentials: OwnerCredentials): Promise<void> {
  const back = page.getByRole("button", { name: "Use a different email" });
  if (await back.isVisible()) await back.click();
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByRole("button", { name: "Continue" }).click();
  // A boxed step with a fixed title: the Playwright report and the list reporter show only
  // "fill the password", never the fill call with its value (O-263).
  await test.step(
    PASSWORD_STEP_TITLE,
    async () => {
      await page.getByLabel("Password", { exact: true }).fill(credentials.password);
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

/** The cookies of this worker's shared stack session, once signInOnce has signed in. */
let sharedSession: readonly Cookie[] | null = null;

/** Signs in through the form at most once per worker and reuses that session afterwards. */
export async function signInOnce(page: Page, credentials: OwnerCredentials): Promise<void> {
  if (sharedSession === null) {
    await signIn(page, credentials);
  } else {
    await page.context().addCookies([...sharedSession]);
    await page.goto(HOME_PATH);
    const signInHeading = page.getByRole("heading", { level: 1, name: "Sign in" });
    const homeHeading = page.getByRole("heading", { level: 1, name: "Home" });
    await expect(signInHeading.or(homeHeading)).toBeVisible();
    if (await signInHeading.isVisible()) await submitLogin(page, credentials);
    await expectHomeShell(page, credentials.email);
  }
  sharedSession = await page.context().cookies();
}

/** The whole flow: redirect to /login, sign in, land on the home shell. */
export async function signIn(page: Page, credentials: OwnerCredentials): Promise<void> {
  await expectRedirectToLogin(page);
  await submitLogin(page, credentials);
  await expectHomeShell(page, credentials.email);
}
