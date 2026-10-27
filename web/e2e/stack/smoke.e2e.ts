/**
 * Playwright smoke flow (R0.3, R0.7), part of the stack project. It is excluded from vitest by
 * the .e2e.ts suffix and by the vitest include pattern in vite.config.ts; playwright.config.ts
 * picks it up through the stack project's testDir and testMatch. It expects the Compose dev profile to be up: the edge Caddy at the base address
 * serves the built web image on / and proxies the api service under /api. The certificate is
 * Caddy's internal one, so the config sets ignoreHTTPSErrors (O-113).
 */
import { expect, test } from "@playwright/test";

const LOGIN_PATH = "/login";
const HEALTH_PATH = "/api/v1/healthz";
const OPENAPI_PATH = "/api/v1/openapi.json";
const OPENAPI_VERSION_PREFIX = /^3\.1/;

test("R0.3 R0.7 smoke: the shell loads through Caddy and the api health JSON answers", async ({
  page,
  request,
}) => {
  await page.goto(LOGIN_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.getByTestId("shell")).toBeVisible();

  const health = await request.get(HEALTH_PATH);
  expect(health.status()).toBe(200);
  const healthBody: unknown = await health.json();
  expect(healthBody).toMatchObject({ status: "ok", service: "api" });

  const openapi = await request.get(OPENAPI_PATH);
  expect(openapi.status()).toBe(200);
  const openapiBody: unknown = await openapi.json();
  expect(openapiBody).toHaveProperty("openapi", expect.stringMatching(OPENAPI_VERSION_PREFIX));
});
