/**
 * ApiProblem parsing tests (R3.13, A5 section 3). Problem bodies are untrusted JSON, so every
 * field is narrowed: a well-formed RFC 9457 body keeps its slug, title and detail, anything else
 * falls back to the "unknown" slug with the status kept.
 */
import { describe, expect, it } from "vitest";

import { ApiProblem, isApiProblem, problemFromBody, problemFromResponse } from "../../src/api/index.js";

describe("ApiProblem", () => {
  it("R3.13 parses a problem body into status, slug, title and detail", () => {
    const problem = problemFromBody(401, {
      type: "urn:g-tee-oh:problem:unauthenticated",
      title: "Authentication required",
      status: 401,
      detail: "No session.",
    });
    expect(problem).toBeInstanceOf(ApiProblem);
    expect(problem.status).toBe(401);
    expect(problem.slug).toBe("unauthenticated");
    expect(problem.title).toBe("Authentication required");
    expect(problem.detail).toBe("No session.");
    expect(isApiProblem(problem)).toBe(true);
  });

  it("R3.13 falls back to the unknown slug for bodies that are not problems", () => {
    for (const body of [null, "text", 42, [], { type: 7 }, { type: "https://example.com/x" }, { type: "urn:g-tee-oh:problem:" }]) {
      const problem = problemFromBody(500, body);
      expect(problem.slug).toBe("unknown");
      expect(problem.status).toBe(500);
      expect(problem.title).toBe("Request failed");
      expect(problem.detail).toBeUndefined();
    }
  });

  it("R3.13 ignores non-string title and detail fields", () => {
    const problem = problemFromBody(400, { type: "urn:g-tee-oh:problem:validation", title: 1, detail: {} });
    expect(problem.slug).toBe("validation");
    expect(problem.title).toBe("Request failed");
    expect(problem.detail).toBeUndefined();
  });

  it("R3.13 isApiProblem rejects plain errors and values", () => {
    expect(isApiProblem(new Error("x"))).toBe(false);
    expect(isApiProblem({ status: 401, slug: "unauthenticated" })).toBe(false);
    expect(isApiProblem(null)).toBe(false);
  });

  it("R3.13 problemFromResponse reads a problem response without consuming the original", async () => {
    const response = new Response(JSON.stringify({ type: "urn:g-tee-oh:problem:csrf", title: "t", status: 403 }), {
      status: 403,
      headers: { "content-type": "application/problem+json" },
    });
    const problem = await problemFromResponse(response);
    expect(problem.slug).toBe("csrf");
    expect(response.bodyUsed).toBe(false);
  });

  it("R3.13 problemFromResponse tolerates a body that is not JSON", async () => {
    const problem = await problemFromResponse(new Response("<html>", { status: 502 }));
    expect(problem.status).toBe(502);
    expect(problem.slug).toBe("unknown");
  });
});
