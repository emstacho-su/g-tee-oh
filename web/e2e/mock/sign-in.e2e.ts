/**
 * The sign-in flow against the mocked api (R3.13, O-264), part of the mock project: the harness
 * production build under `vite preview` on http://localhost:4173, with every /api/v1 request
 * answered by e2e/support/mock-api.ts through page.route. No Docker; `just e2e-mock` runs it
 * locally and the e2e CI job runs it before the stack flows. Each test gets a fresh page and so
 * a fresh, signed-out mock.
 */
import { expect, test } from "@playwright/test";

import { FIXTURE_CSRF_TOKEN, FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { CSRF_HEADER, installMockApi, LOGIN_PATH, LOGOUT_PATH, ME_PATH } from "../support/mock-api.js";
import type { OwnerCredentials } from "../support/owner-credentials.js";
import { expectHomeShell, expectRedirectToLogin, signIn, signOut, submitLogin } from "../support/sign-in-flow.js";

const OWNER: OwnerCredentials = { email: FIXTURE_USER_EMAIL, password: "any-non-empty-password" };
const STRANGER: OwnerCredentials = { email: "someone@example.com", password: "any-non-empty-password" };
const FORBIDDEN = 403;
const CSRF_PROBLEM_TYPE = "urn:g-tee-oh:problem:csrf";

interface FetchResult {
  status: number;
  body: unknown;
}

test("R3.13 mock: sign in and land on the home shell, then sign out", async ({ page }) => {
  await installMockApi(page);
  await signIn(page, OWNER);
  await signOut(page);
});

test("R3.13 mock: a rejected sign-in stays on the login page", async ({ page }) => {
  const api = await installMockApi(page);
  await expectRedirectToLogin(page);
  await submitLogin(page, STRANGER);
  await expect.poll(() => api.requests().some((request) => request.path === LOGIN_PATH)).toBe(true);
  await expect(page).toHaveURL((url) => url.pathname === "/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  // Still signed out: a fresh visit to / goes back to the login page.
  await expectRedirectToLogin(page);
});

test("R3.13 mock: reloading the home page keeps the user signed in through /me", async ({ page }) => {
  const api = await installMockApi(page);
  await signIn(page, OWNER);
  const before = api.requests().length;
  await page.reload();
  await expectHomeShell(page, OWNER.email);
  const afterReload = api.requests().slice(before);
  expect(afterReload.some((request) => request.method === "GET" && request.path === ME_PATH)).toBe(true);
});

test("R3.13 mock: logout without the csrf token is refused; the app's logout sends it", async ({ page }) => {
  const api = await installMockApi(page);
  await signIn(page, OWNER);

  const refused = await page.evaluate(async (path): Promise<FetchResult> => {
    const response = await fetch(path, { method: "POST", credentials: "same-origin" });
    return { status: response.status, body: (await response.json()) as unknown };
  }, LOGOUT_PATH);
  expect(refused.status).toBe(FORBIDDEN);
  expect(refused.body).toMatchObject({ type: CSRF_PROBLEM_TYPE });

  await page.reload();
  await expectHomeShell(page, OWNER.email);

  await signOut(page);
  const logouts = api.requests().filter((request) => request.method === "POST" && request.path === LOGOUT_PATH);
  expect(logouts.map((request) => request.headers[CSRF_HEADER])).toEqual([undefined, FIXTURE_CSRF_TOKEN]);
});
