// Tests for e2e/support/owner-credentials.ts (R3.13, O-263): the stack sign-in flow reads the
// owner from E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD, which infra/compose/e2e.mjs sets for the
// e2e-web child only, and skips with a reason when either is missing.
import { describe, expect, it } from "vitest";

import { ownerCredentials } from "../../e2e/support/owner-credentials.js";

// A low-entropy stand-in built at run time, so no literal here looks like a credential to a secret scanner.
const STAND_IN_PASSWORD = "x".repeat(16);

describe("R3.13 owner credentials", () => {
  it("R3.13 returns both values when both are set", () => {
    const env = { E2E_OWNER_EMAIL: "e2e-owner@example.com", E2E_OWNER_PASSWORD: STAND_IN_PASSWORD };
    expect(ownerCredentials(env)).toEqual({ email: "e2e-owner@example.com", password: STAND_IN_PASSWORD });
  });

  it("R3.13 trims the email but keeps the password exactly as given", () => {
    const env = { E2E_OWNER_EMAIL: " e2e-owner@example.com ", E2E_OWNER_PASSWORD: " spaced " };
    expect(ownerCredentials(env)).toEqual({ email: "e2e-owner@example.com", password: " spaced " });
  });

  it("R3.13 returns undefined when either value is missing or blank", () => {
    expect(ownerCredentials({})).toBeUndefined();
    expect(ownerCredentials({ E2E_OWNER_EMAIL: "e2e-owner@example.com" })).toBeUndefined();
    expect(ownerCredentials({ E2E_OWNER_PASSWORD: "pw" })).toBeUndefined();
    expect(ownerCredentials({ E2E_OWNER_EMAIL: "  ", E2E_OWNER_PASSWORD: "pw" })).toBeUndefined();
    expect(ownerCredentials({ E2E_OWNER_EMAIL: "a@example.com", E2E_OWNER_PASSWORD: "" })).toBeUndefined();
  });
});
