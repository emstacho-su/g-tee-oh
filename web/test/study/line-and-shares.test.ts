// Tests for the line helpers (S25, R3.12, O-286), the range_by_action mapping (O-280, O-198) and
// the safe failure texts: pure functions the study screen composes.
import { describe, expect, it } from "vitest";

import { ApiProblem } from "../../src/api/index.js";
import { fixtureChildNode, fixtureRootNode } from "../../src/fixtures/study.js";
import { breadcrumbSteps, childLine, lineLabel } from "../../src/study/line.js";
import { catalogFailure, insightsFailure, nodeFailure } from "../../src/study/problem-text.js";
import { sharesByPosition } from "../../src/study/range-shares.js";

function problem(status: number, slug: string): ApiProblem {
  return new ApiProblem({ status, slug, title: "title", detail: "server detail text" });
}

describe("R3.12 study line helpers", () => {
  it("R3.12 the child line appends the token with a dot, or is the token at the root", () => {
    expect(childLine(undefined, "r250")).toBe("r250");
    expect(childLine("", "r250")).toBe("r250");
    expect(childLine("r250", "r1100")).toBe("r250.r1100");
  });

  it("R3.12 the breadcrumb has the root and one step per token, each with its own line", () => {
    expect(breadcrumbSteps(undefined)).toEqual([{ label: "Root", line: "" }]);
    expect(breadcrumbSteps("r250.r1100")).toEqual([
      { label: "Root", line: "" },
      { label: "r250", line: "r250" },
      { label: "r1100", line: "r250.r1100" },
    ]);
  });

  it("R3.12 the log label of the root is root", () => {
    expect(lineLabel("")).toBe("root");
    expect(lineLabel(undefined)).toBe("root");
    expect(lineLabel("r250")).toBe("r250");
  });
});

describe("R3.12 range by action", () => {
  it("R3.12 maps each { index, share } entry to its action's position", () => {
    const reversed = { ...fixtureRootNode, range_by_action: [...fixtureRootNode.range_by_action].reverse() };
    expect(sharesByPosition(reversed.actions, reversed.range_by_action)).toEqual({
      kind: "ok",
      shares: [0.55, 0.05, 0.38, 0.02],
    });
  });

  it("R3.12 an action without an entry, an extra entry or a repeated index is a mismatch", () => {
    const actions = fixtureChildNode.actions;
    const missing = sharesByPosition(actions, fixtureChildNode.range_by_action.slice(1));
    expect(missing).toEqual({ kind: "mismatch", problem: "4 actions but 3 range shares" });
    const repeated = sharesByPosition(actions, [
      { index: 0, share: 0.5 },
      { index: 0, share: 0.1 },
      { index: 2, share: 0.3 },
      { index: 3, share: 0.1 },
    ]);
    expect(repeated).toEqual({ kind: "mismatch", problem: "action 1 has no range share" });
  });
});

describe("R3.12 study failure texts", () => {
  it("R3.12 node failures name the case and never the server detail", () => {
    expect(nodeFailure(problem(404, "not-found"))).toEqual({
      message: "The library holds no solution for this pair and line.",
      retryable: false,
    });
    expect(nodeFailure(problem(502, "upstream")).retryable).toBe(true);
    expect(nodeFailure(problem(503, "unavailable")).message).toMatch(/busy/);
    expect(nodeFailure(new TypeError("Failed to fetch")).retryable).toBe(true);
    for (const status of [404, 502, 503, 500]) {
      expect(nodeFailure(problem(status, "x")).message).not.toContain("server detail text");
    }
  });

  it("R3.12 insights failures say when the hand left the range", () => {
    expect(insightsFailure(problem(404, "hand-not-in-range"), "72o")).toEqual({
      message: "72o is not in the range at this node, so it has no threshold card.",
      retryable: false,
    });
    expect(insightsFailure(problem(404, "not-found"), "AKs").retryable).toBe(false);
    expect(insightsFailure(problem(503, "unavailable"), "AKs").retryable).toBe(true);
  });

  it("R3.12 catalog failures are retryable", () => {
    expect(catalogFailure()).toEqual({
      message: "The game catalog could not be loaded.",
      retryable: true,
    });
  });
});
