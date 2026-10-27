import { describe, expect, it } from "vitest";

import {
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  ARGON2_PASSES,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "../src/auth/password.js";
import { hashSessionToken, isWellFormedToken, newCsrfToken, newSessionToken, tokensEqual } from "../src/auth/tokens.js";

describe("R3.1 argon2id password hashing", () => {
  it("R3.1 hashes to an argon2id PHC string with the OWASP parameters (19 MiB, t=2, p=1)", async () => {
    const phc = await hashPassword("hunter2hunter2");

    expect(ARGON2_MEMORY_KIB).toBeGreaterThanOrEqual(19 * 1024);
    expect(phc).toMatch(
      new RegExp(`^\\$argon2id\\$v=19\\$m=${ARGON2_MEMORY_KIB},t=${ARGON2_PASSES},p=${ARGON2_PARALLELISM}\\$`),
    );
  });

  it("R3.1 verifies the right password and rejects a wrong one", async () => {
    const phc = await hashPassword("hunter2hunter2");

    await expect(verifyPassword(phc, "hunter2hunter2")).resolves.toBe(true);
    await expect(verifyPassword(phc, "hunter3hunter3")).resolves.toBe(false);
  });

  it("R3.1 salts every hash, so the same password hashes differently twice", async () => {
    const [first, second] = await Promise.all([hashPassword("same"), hashPassword("same")]);

    expect(first).not.toBe(second);
  });

  it("R3.1 never matches a malformed or out-of-bounds stored hash", async () => {
    await expect(verifyPassword("plain text", "plain text")).resolves.toBe(false);
    await expect(verifyPassword("$argon2id$v=19$m=99999999,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2g", "x")).resolves.toBe(
      false,
    );
  });

  it("R3.1 the dummy hash is well formed, so an unknown email costs a real verification", async () => {
    await expect(verifyPassword(DUMMY_PASSWORD_HASH, "anything")).resolves.toBe(false);
  });
});

describe("R3.1 session and CSRF tokens (O-230, O-231)", () => {
  it("R3.1 a session token is 32 random bytes as base64url and its hash is its sha256", () => {
    const { token, hash } = newSessionToken();

    expect(isWellFormedToken(token)).toBe(true);
    expect(hash.equals(hashSessionToken(token))).toBe(true);
    expect(hash).toHaveLength(32);
    expect(newSessionToken().token).not.toBe(token);
  });

  it("R3.1 CSRF tokens are well formed and compared in full", () => {
    const csrf = newCsrfToken();

    expect(isWellFormedToken(csrf)).toBe(true);
    expect(tokensEqual(csrf, csrf)).toBe(true);
    expect(tokensEqual(csrf, `${csrf.slice(0, -1)}x`)).toBe(csrf.endsWith("x"));
    expect(tokensEqual(csrf, csrf.slice(1))).toBe(false);
  });
});
