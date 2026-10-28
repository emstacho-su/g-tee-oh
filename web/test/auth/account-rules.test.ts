/**
 * The web's mirror of the api's account rules (S42 review round 1, I and J). The name's raw length
 * limit and its rule text are held to the committed contract, so the mirror cannot drift from the
 * api without a failing test; the name rules are checked case by case.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EMAIL_SHAPE,
  MAX_NAME_LENGTH,
  MAX_RAW_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  meetsPasswordMinimum,
  nameProblem,
} from "../../src/auth/account-rules.js";

const CONTRACT = join(process.cwd(), "..", "packages", "contracts", "api.openapi.json");

interface StringSchema {
  maxLength?: number;
  description?: string;
}

function joinBodyProperties(): Record<string, StringSchema> {
  const document = JSON.parse(readFileSync(CONTRACT, "utf8")) as {
    paths: Record<string, { post: { requestBody: { content: Record<string, { schema: { properties: Record<string, StringSchema> } }> } } }>;
  };
  const schema = document.paths["/api/v1/auth/join"]?.post.requestBody.content["application/json"]?.schema;
  if (schema === undefined) throw new Error("the contract has no POST /auth/join body");
  return schema.properties;
}

describe("R3.13 account rules mirror the contract", () => {
  it("R3.13 the raw name limit, the name length and the password minimum match the committed contract", () => {
    const properties = joinBodyProperties();
    expect(properties.display_name?.maxLength).toBe(MAX_RAW_NAME_LENGTH);
    expect(properties.display_name?.description).toContain(`1 to ${MAX_NAME_LENGTH} characters`);
    expect(properties.password?.description).toContain(`At least ${MIN_PASSWORD_LENGTH} characters`);
  });

  it.each([
    ["Sam", null],
    ["", "empty"],
    ["a".repeat(MAX_NAME_LENGTH + 1), "too-long"],
    ["Sam‮Rivera", "forbidden-character"],
    ["ㅤ", "forbidden-character"],
    ["⠀", "no-letter"],
    ["́", "no-letter"],
  ])("R3.13 nameProblem(%j)", (name, expected) => {
    expect(nameProblem(name)).toBe(expected);
  });

  it("R3.13 the password minimum counts characters and the email shape is loose", () => {
    expect(meetsPasswordMinimum("😀".repeat(MIN_PASSWORD_LENGTH))).toBe(true);
    expect(meetsPasswordMinimum("a".repeat(MIN_PASSWORD_LENGTH - 1))).toBe(false);
    expect(EMAIL_SHAPE.test("name@example.com")).toBe(true);
    expect(EMAIL_SHAPE.test("a@b")).toBe(false);
  });
});
