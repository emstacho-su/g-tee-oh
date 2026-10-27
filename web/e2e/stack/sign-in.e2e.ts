/**
 * Sign in through Caddy and land on the home shell (R3.13), part of the stack project. It runs
 * against the Compose dev profile with the real api and database: infra/compose/e2e.mjs creates
 * a fresh owner per run (O-263) and hands its email and random password to this process through
 * E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD, so `just e2e` and CI always run it. A manual
 * `just e2e-web` without those two variables skips it with the reason below. The session cookie
 * is Secure, so the flow needs https; the certificate is Caddy's internal one (O-113).
 */
import { test } from "@playwright/test";

import { ownerCredentials } from "../support/owner-credentials.js";
import { signIn, signOut } from "../support/sign-in-flow.js";

const credentials = ownerCredentials(process.env);
const SKIP_REASON =
  "R3.13 needs E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD; just e2e creates the owner and sets both";

test("R3.13 sign in through Caddy and land on the home shell", async ({ page }) => {
  test.skip(credentials === undefined, SKIP_REASON);
  if (credentials === undefined) return;

  await signIn(page, credentials);
  await signOut(page);
});
