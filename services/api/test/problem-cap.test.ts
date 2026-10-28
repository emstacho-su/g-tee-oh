/**
 * The field-error cap on every route's validation problem (R3.14, R3.1, PR #30 review MEDIUM 1,
 * http/field-error-cap.ts). A body with many errors answers at most MAX_PROBLEM_ERRORS of them
 * and the count of the rest in errors_omitted; unknown keys are reported as their object's path
 * and a count, never as the key text, and the response still matches the committed contract.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { capErrors, MAX_PROBLEM_ERRORS, safeIssueMessage, unknownKeysMessage } from "../src/http/field-error-cap.js";
import { buildTestApp, mutatingHeaders } from "./support/app.js";
import { contractErrors } from "./support/contract.js";
import { appDatabase, createTestSession, createTestUser, type TestSession } from "./support/database.js";

/** Under the 20-tag limit, so each one fails the tag pattern on its own. */
const BAD_TAGS = 15;
/** An empty spot_filter misses 9 required fields and an empty trainer 10. */
const EMPTY_OBJECT_ISSUES = 19;
const EXPECTED_ISSUES = BAD_TAGS + EMPTY_OBJECT_ISSUES;
const SECRET_KEY = "zzbodykeytextzz";

interface ProblemBody {
  errors?: { path: string; message: string }[];
  errors_omitted?: number;
}

describe("R3.14 the field-error cap on every route (MEDIUM 1)", () => {
  let database: Database;
  let app: ApiApp;
  let session: TestSession;

  beforeAll(async () => {
    database = appDatabase();
    app = buildTestApp(database);
    await app.ready();
    session = await createTestSession(database, (await createTestUser(database)).id);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  function postDrill(payload: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/api/v1/drills", headers: mutatingHeaders(session), payload });
  }

  it("R3.14 a body with many errors lists 20 and counts the rest in errors_omitted", async () => {
    const response = await postDrill({ name: "x", tags: Array.from({ length: BAD_TAGS }, () => "!"), spot_filter: {}, trainer: {} });
    expect(response.statusCode).toBe(400);
    const problem = response.json<ProblemBody>();
    expect(problem.errors).toHaveLength(MAX_PROBLEM_ERRORS);
    expect(problem.errors_omitted).toBe(EXPECTED_ISSUES - MAX_PROBLEM_ERRORS);
    expect(contractErrors("post", "/api/v1/drills", 400, problem)).toEqual([]);
  });

  it("R3.14 a body with few errors has no errors_omitted", async () => {
    const response = await postDrill({ name: "" });
    const problem = response.json<ProblemBody>();
    expect(problem.errors?.length ?? 0).toBeLessThanOrEqual(MAX_PROBLEM_ERRORS);
    expect(problem.errors_omitted).toBeUndefined();
  });

  it("R3.14 an unknown body key is counted at its object's path, never echoed", async () => {
    const response = await postDrill({ name: "x", [SECRET_KEY]: 1 });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(SECRET_KEY);
    expect(response.json<ProblemBody>().errors).toContainEqual({ path: "body", message: unknownKeysMessage(1) });
  });
});

describe("R3.14 field-error-cap helpers", () => {
  it("R3.14 capErrors keeps 20 and counts the rest; a short list is kept whole", () => {
    const many = Array.from({ length: 25 }, (_, index) => index);
    expect(capErrors(many)).toEqual({ kept: many.slice(0, MAX_PROBLEM_ERRORS), omitted: 5 });
    expect(capErrors([1, 2])).toEqual({ kept: [1, 2], omitted: 0 });
  });

  it("R3.14 safeIssueMessage counts unknown keys and leaves other messages alone", () => {
    expect(safeIssueMessage("unrecognized_keys", `Unrecognized keys: "${SECRET_KEY}"`, [SECRET_KEY, "b"])).toBe("2 unknown keys");
    expect(safeIssueMessage("unrecognized_keys", "Unrecognized key", undefined)).toBe("1 unknown key");
    expect(safeIssueMessage("too_big", "Too big", undefined)).toBe("Too big");
  });
});
