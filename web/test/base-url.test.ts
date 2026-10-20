// Tests for e2e/base-url.ts (R0.3, R0.7): the Playwright base address agrees with the site the
// edge Caddy serves. The resolver takes the environment and the .env lookup as arguments, so no
// test touches the real process environment or the repo .env.
import { describe, expect, it } from "vitest";

import { DEFAULT_BASE_URL, resolveBaseUrl } from "../e2e/base-url.js";

const NOTHING_IN_FILE = (): string | undefined => undefined;
const SITE_IN_FILE = (name: string): string | undefined =>
  name === "CADDY_SITE" ? "other.lan" : undefined;

describe("R0.3 e2e base URL", () => {
  it("R0.3 E2E_BASE_URL wins when set", () => {
    const env = { E2E_BASE_URL: "https://ci-runner:8443", CADDY_SITE: "zenbook.lan" };
    expect(resolveBaseUrl(env, SITE_IN_FILE)).toBe("https://ci-runner:8443");
  });

  it("R0.3 CADDY_SITE from the environment comes next, then CADDY_SITE from the repo .env", () => {
    expect(resolveBaseUrl({ CADDY_SITE: "zenbook.lan" }, SITE_IN_FILE)).toBe("https://zenbook.lan");
    expect(resolveBaseUrl({}, SITE_IN_FILE)).toBe("https://other.lan");
  });

  it("R0.3 https://localhost is the fallback, and a blank value counts as unset", () => {
    expect(DEFAULT_BASE_URL).toBe("https://localhost");
    expect(resolveBaseUrl({}, NOTHING_IN_FILE)).toBe(DEFAULT_BASE_URL);
    expect(resolveBaseUrl({ E2E_BASE_URL: "  ", CADDY_SITE: "" }, () => "")).toBe(DEFAULT_BASE_URL);
    const padded = { E2E_BASE_URL: "", CADDY_SITE: " zenbook.lan " };
    expect(resolveBaseUrl(padded, NOTHING_IN_FILE)).toBe("https://zenbook.lan");
  });
});
