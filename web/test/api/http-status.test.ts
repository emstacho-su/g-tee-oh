/**
 * Tests for the shared status codes and the log-safe failure description (R3.13): a logged
 * session failure names only a status and a problem slug, or an error name, never a body.
 */
import { describe, expect, it } from "vitest";

import { describeFailureForLog, HTTP_STATUS } from "../../src/api/http-status.js";
import { ApiProblem } from "../../src/api/index.js";

describe("R3.13 http status and log-safe failures", () => {
  it("R3.13 names the statuses the session, study and trainer code branch on", () => {
    expect(HTTP_STATUS).toEqual({
      badRequest: 400,
      unauthorized: 401,
      forbidden: 403,
      notFound: 404,
      conflict: 409,
      unprocessable: 422,
      tooManyRequests: 429,
      badGateway: 502,
      unavailable: 503,
    });
  });

  it("R3.13 describes a problem by status and slug, never by its detail", () => {
    const problem = new ApiProblem({ status: 503, slug: "unavailable", title: "t", detail: "secret detail" });
    const text = describeFailureForLog(problem);
    expect(text).toBe("status 503, problem unavailable");
    expect(text).not.toContain("secret detail");
  });

  it("R3.13 describes other failures by error name only", () => {
    expect(describeFailureForLog(new TypeError("Failed to fetch https://host/?token=x"))).toBe("TypeError");
    expect(describeFailureForLog("thrown string")).toBe("unknown failure");
  });
});
