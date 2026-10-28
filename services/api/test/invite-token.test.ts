/**
 * Unit tests of the invite token and the display name rules (S42, R3.1, O-422, O-426): the token
 * format, parsing that refuses every other shape, the constant-time digest compare, and the name
 * schema that trims and refuses control and invisible formatting characters.
 */
import { describe, expect, it } from "vitest";

import {
  formatInviteToken,
  hashInviteSecret,
  MAX_INVITE_TOKEN_LENGTH,
  newInviteSecret,
  parseInviteToken,
  secretMatches,
  UNKNOWN_INVITE_DIGEST,
} from "../src/auth/invite-token.js";
import { digestsEqual } from "../src/auth/tokens.js";
import { displayNameSchema, joinBodySchema } from "../src/schemas/invites.js";

const ID = "01890a5d-ac96-774b-bcce-b302099a8057";

describe("R3.1 invite token", () => {
  it("R3.1 a new secret is 43 base64url characters and its hash is a 32-byte sha256", () => {
    const { secret, hash } = newInviteSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toHaveLength(32);
    expect(hash.equals(hashInviteSecret(secret))).toBe(true);
    expect(newInviteSecret().secret).not.toBe(secret);
  });

  it("R3.1 format and parse round trip, the selector lowercased", () => {
    const { secret } = newInviteSecret();
    expect(parseInviteToken(formatInviteToken(ID, secret))).toEqual({ selector: ID, secret });
    expect(parseInviteToken(formatInviteToken(ID.toUpperCase(), secret))).toEqual({ selector: ID, secret });
  });

  it.each([
    ["empty", ""],
    ["no separator", `${ID}abc`],
    ["not a uuid", `not-a-uuid.${"a".repeat(43)}`],
    ["short secret", `${ID}.${"a".repeat(42)}`],
    ["long secret", `${ID}.${"a".repeat(44)}`],
    ["padded secret", `${ID}.${"a".repeat(42)}=`],
    ["second separator", `${ID}.${"a".repeat(20)}.${"a".repeat(22)}`],
    ["too long", "a".repeat(MAX_INVITE_TOKEN_LENGTH + 1)],
  ])("R3.1 parse refuses a token that is %s", (_label, token) => {
    expect(parseInviteToken(token)).toBeNull();
  });

  it("R3.1 secretMatches accepts the secret and refuses one differing in its last character", () => {
    const { secret, hash } = newInviteSecret();
    const last = secret.at(-1) === "A" ? "B" : "A";
    expect(secretMatches(hash, secret)).toBe(true);
    expect(secretMatches(hash, `${secret.slice(0, -1)}${last}`)).toBe(false);
    expect(secretMatches(UNKNOWN_INVITE_DIGEST, secret)).toBe(false);
  });

  it("R3.1 digestsEqual compares equal, unequal and different-length buffers without throwing", () => {
    const left = hashInviteSecret("left");
    expect(digestsEqual(left, Buffer.from(left))).toBe(true);
    expect(digestsEqual(left, hashInviteSecret("right"))).toBe(false);
    expect(digestsEqual(left, left.subarray(0, 16))).toBe(false);
    expect(digestsEqual(Buffer.alloc(0), Buffer.alloc(0))).toBe(true);
  });
});

describe("R3.1 display name (O-426)", () => {
  it("R3.1 trims surrounding whitespace", () => {
    expect(displayNameSchema.parse("  Sam Rivera \t")).toBe("Sam Rivera");
    // ECMAScript's trim treats a byte order mark as whitespace, so a leading one is trimmed away.
    expect(displayNameSchema.parse("﻿Sam")).toBe("Sam");
  });

  it("R3.1 counts characters, not UTF-16 units, up to 60", () => {
    expect(displayNameSchema.parse("é".repeat(60))).toHaveLength(60);
    expect(displayNameSchema.parse(`A${"😀".repeat(59)}`)).toBe(`A${"😀".repeat(59)}`);
    expect(displayNameSchema.safeParse("😀".repeat(3)).success).toBe(false);
    expect(displayNameSchema.safeParse("a".repeat(61)).success).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["only spaces", "    "],
    ["a newline", "Sam\nRivera"],
    ["a NUL", "Sam\u0000"],
    ["an escape", "Sam\u001b[31m"],
    ["a DEL", "Sam\u007f"],
    ["a right-to-left override", "Sam‮avirR"],
    ["a left-to-right isolate", "Sam⁦x⁩"],
    ["a zero-width space", "Sam​Rivera"],
    ["a zero-width joiner", "Sam‍Rivera"],
    ["a byte order mark inside", "Sam﻿Rivera"],
    ["a soft hyphen", "Sam­Rivera"],
    ["a line separator", "Sam Rivera"],
    ["a paragraph separator", "Sam Rivera"],
    // Review round 1, F: names that look blank or hide characters.
    ["only a Hangul filler", "ㅤ"],
    ["only a halfwidth Hangul filler", "ﾠ"],
    ["only a braille blank", "⠀"],
    ["only combining marks", "́̂̃"],
    ["a Hangul filler inside", "SamㅤRivera"],
    ["a variation selector", "Sam️"],
    ["only punctuation", "--..--"],
  ])("R3.1 refuses %s", (_label, name) => {
    expect(displayNameSchema.safeParse(name).success).toBe(false);
  });

  it.each([["Zoë"], ["李小龙"], ["O'Brien-Smith"], ["Ana 2"], ["José María"]])("R3.1 accepts the name %j", (name) => {
    expect(displayNameSchema.parse(name)).toBe(name);
  });

  it("R3.1 the join body refuses a password under 12 characters and an unknown key", () => {
    expect(joinBodySchema.safeParse({ token: "t", display_name: "Sam", password: "short" }).success).toBe(false);
    expect(
      joinBodySchema.safeParse({ token: "t", display_name: "Sam", password: "long enough pass", is_admin: true }).success,
    ).toBe(false);
    expect(joinBodySchema.safeParse({ token: "t", display_name: "Sam", password: "long enough pass" }).success).toBe(true);
  });
});
