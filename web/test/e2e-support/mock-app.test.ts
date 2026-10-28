// Tests for e2e/support/mock-app.ts (S27, R3.16, R3.17, O-264): the composed app mock answers GET
// /drills once for every screen, so both the /predict and the /paint pickers find their fixture
// drills whichever feature route answers first.
import { describe, expect, it } from "vitest";

import { createAppMockApi } from "../../e2e/support/mock-app.js";
import type { MockRequest } from "../../e2e/support/mock-api.js";
import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { FIXTURE_PAINT_DRILL_ID } from "../../src/fixtures/paint.js";
import { fixtureDrill } from "../../src/fixtures/trainer.js";

function request(method: string, path: string, init: Partial<MockRequest> = {}): MockRequest {
  return { method, path, query: {}, headers: {}, body: undefined, ...init };
}

describe("R3.16 R3.17 the composed app mock", () => {
  it("R3.17 GET /drills lists the paint drill and the prediction drill, each once", () => {
    const api = createAppMockApi();
    api.handle(request("POST", "/api/v1/auth/login", { body: { email: FIXTURE_USER_EMAIL, password: "x" } }));
    const response = api.handle(request("GET", "/api/v1/drills"));
    expect(response.status).toBe(200);
    const ids = (response.body as { items: { id: string }[] }).items.map((drill) => drill.id);
    expect(ids).toContain(FIXTURE_PAINT_DRILL_ID);
    expect(ids).toContain(fixtureDrill.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
