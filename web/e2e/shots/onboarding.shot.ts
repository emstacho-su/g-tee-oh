/**
 * Screenshots of the S42 onboarding screens for the owner's review (O-349, O-421 to O-427): the
 * join page (empty, with the strength meter reading, and the invalid-link notice), the redirecting
 * state, and the admin Invites page with its one-time link dialog. Mocked api, synthetic data
 * only (O-26); both themes at both widths, merged into the shared manifest.
 *
 * The redirecting state shows for 400 ms (O-425); the page clock is installed before the join so
 * that state holds still for its picture, then the clock runs on to home.
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { installAppMockApi } from "../support/mock-app.js";
import { MOCK_INVITE_TOKEN } from "../support/mock-join.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const SESSION = "S42";
const SOURCE = "mock";
const OWNER = { email: FIXTURE_USER_EMAIL, password: "synthetic-password" };
const REDIRECT_RUN_MS = 1_000;

const CRITERIA = {
  join: "S42 join by invite: the invite fixes the email (a read-only chip); one form asks a name and a password; centred column on the S36 palette (O-349, O-421)",
  joinStrength: "S42 the live strength meter: four segments and a word, advisory; only the 12-character minimum blocks (O-424)",
  joinInvalid: "S42 a bad, expired, used or revoked link reads one fixed message with a way to sign in (O-422)",
  redirecting: "S42 the short redirecting state after joining or signing in, at least 400 ms (O-425)",
  invites: "S42 admin Invites page in /settings: create by email, the newest invites with their status, Revoke on pending ones (R3.5, O-349)",
  inviteLink: "S42 the join link shown once in a dialog with Copy; kept out of caches and storage and dropped on close (O-427)",
  revoke: "S42 revoking asks first and names the email (R3.5)",
} as const;

const records: ShotRecord[] = [];

function shooter(page: Page, theme: Theme, viewport: Viewport) {
  return async (screen: string, criterion: string, target: Page | Locator = page) => {
    records.push(await capture(target, page, OUT_DIR, { screen, theme, viewport, criterion, source: SOURCE }));
  };
}

async function joinScreens(page: Page, shot: ReturnType<typeof shooter>): Promise<void> {
  await page.clock.install();
  await installAppMockApi(page, { admin: false });
  await page.goto(`/join#${MOCK_INVITE_TOKEN}`);
  await expect(page.getByLabel("Name")).toBeVisible();
  await shot("join", CRITERIA.join);

  await page.getByLabel("Name").fill("Sam Rivera");
  await page.getByLabel("Password", { exact: true }).fill("plum orbit lantern seventy");
  await expect(page.getByTestId("strength-meter")).toHaveAttribute("data-score", /[34]/);
  await shot("join-strength", CRITERIA.joinStrength);

  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Setting up your account")).toBeVisible();
  await shot("redirecting", CRITERIA.redirecting);
  await page.clock.runFor(REDIRECT_RUN_MS);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  await page.goto(`/join#${MOCK_INVITE_TOKEN}`);
  await expect(page.getByRole("alert")).toBeVisible();
  await shot("join-invalid", CRITERIA.joinInvalid);
}

async function inviteScreens(page: Page, shot: ReturnType<typeof shooter>): Promise<void> {
  await installAppMockApi(page);
  await page.goto("/login");
  await submitLogin(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await page.goto("/settings/invites");
  await expect(page.getByRole("list", { name: "Recent invites" })).toBeVisible();
  await shot("settings-invites", CRITERIA.invites);

  await page.getByLabel("Email to invite").fill("new.friend@example.com");
  await page.getByRole("button", { name: "Create invite" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite link" });
  await expect(dialog).toBeVisible();
  await shot("settings-invite-link", CRITERIA.inviteLink);
  await dialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Revoke pending.friend@example.com" }).click();
  await expect(page.getByRole("dialog", { name: "Revoke this invite?" })).toBeVisible();
  await shot("settings-invite-revoke", CRITERIA.revoke);
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  mergeShotManifest(OUT_DIR, SESSION, records);
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`R3.13 R3.5 onboarding screenshots, ${theme} theme, ${viewport.label} width`, async ({ browser }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      const joinContext = await browser.newContext({ baseURL: "http://localhost:4173" });
      const adminContext = await browser.newContext({ baseURL: "http://localhost:4173" });
      try {
        const joinPage = await joinContext.newPage();
        await prepareShotPage(joinPage, theme, viewport);
        await joinScreens(joinPage, shooter(joinPage, theme, viewport));
        const adminPage = await adminContext.newPage();
        await prepareShotPage(adminPage, theme, viewport);
        await inviteScreens(adminPage, shooter(adminPage, theme, viewport));
      } finally {
        await joinContext.close();
        await adminContext.close();
      }
    });
  }
}
