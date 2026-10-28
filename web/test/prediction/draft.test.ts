/**
 * The prediction answer drafts and fixed text (S27 lane A, R3.16, O-301): a draft per kind, the
 * conversion to the contract answer, region toggling in offered order, the aggressive actions of
 * the size question, the level badge and the problem text by kind.
 */
import { describe, expect, it } from "vitest";

import { ApiProblem } from "../../src/api/index.js";
import { fixturePredictionPrompt } from "../../src/fixtures/prediction.js";
import { aggressiveActions, emptyDraft, toAnswer, toggleRegion } from "../../src/prediction/draft.js";
import { levelBadge, problemText, unlockedText, windowText } from "../../src/prediction/labels.js";
import type { HandRegion } from "../../src/prediction/types.js";

const OFFERED: HandRegion[] = ["pairs", "suited_aces", "suited_connectors", "offsuit_other"];

function problem(status: number, slug: string): ApiProblem {
  return new ApiProblem({ status, slug, title: "t", detail: "server detail text" });
}

describe("R3.16 prediction answer drafts", () => {
  it("R3.16 an empty draft is incomplete except for regions, where no region is an answer", () => {
    expect(toAnswer(emptyDraft("yes_no"))).toBeNull();
    expect(toAnswer(emptyDraft("percent"))).toBeNull();
    expect(toAnswer(emptyDraft("action"))).toBeNull();
    expect(toAnswer(emptyDraft("size"))).toBeNull();
    expect(toAnswer(emptyDraft("band"))).toBeNull();
    expect(toAnswer(emptyDraft("regions"))).toEqual({ kind: "regions", value: [] });
  });

  it("R3.16 complete drafts become contract answers", () => {
    expect(toAnswer({ kind: "yes_no", value: false })).toEqual({ kind: "yes_no", value: false });
    expect(toAnswer({ kind: "action", actionIndex: 2 })).toEqual({ kind: "action", action_index: 2 });
    expect(toAnswer({ kind: "size", actionIndex: 3 })).toEqual({ kind: "size", action_index: 3 });
    expect(toAnswer({ kind: "band", band: "25_50" })).toEqual({ kind: "band", band: "25_50" });
  });

  it("R3.16 a percent reads only as a number from 0 to 100", () => {
    expect(toAnswer({ kind: "percent", text: "35" })).toEqual({ kind: "percent", value: 35 });
    expect(toAnswer({ kind: "percent", text: "0" })).toEqual({ kind: "percent", value: 0 });
    expect(toAnswer({ kind: "percent", text: "100" })).toEqual({ kind: "percent", value: 100 });
    for (const text of ["", "  ", "-5", "105", "abc"]) {
      expect(toAnswer({ kind: "percent", text }), text).toBeNull();
    }
  });

  it("R3.16 toggling a region adds or removes it and keeps the offered order", () => {
    const one = toggleRegion({ kind: "regions", value: [] }, "suited_connectors", OFFERED);
    const two = toggleRegion(one as { kind: "regions"; value: HandRegion[] }, "pairs", OFFERED);
    expect(two).toEqual({ kind: "regions", value: ["pairs", "suited_connectors"] });
    expect(toggleRegion(two as { kind: "regions"; value: HandRegion[] }, "pairs", OFFERED)).toEqual({ kind: "regions", value: ["suited_connectors"] });
  });

  it("R3.16 the size question offers the bets, raises and all-ins only", () => {
    expect(aggressiveActions(fixturePredictionPrompt("size")).map((action) => action.index)).toEqual([2, 3]);
  });
});

describe("R3.16 prediction text", () => {
  it("R3.16 the level badge, unlock line and window line", () => {
    expect(levelBadge("hand", 3)).toBe("Hand level 3 of 3");
    expect(unlockedText("range", 2)).toBe("Next level unlocked: Range level 2 of 3");
    expect(windowText({ answers: 12, correct: 9, size: 20, required_pct: 90 })).toBe(
      "Last 20 at this level: 9 correct of 12 (90 percent unlocks the next level)",
    );
  });

  it("R3.16 problems show fixed text by slug, then status, never the server's detail", () => {
    expect(problemText(problem(409, "session-ended"))).toMatch(/This session has ended/);
    expect(problemText(problem(409, "wrong-session-mode"))).toMatch(/not a prediction session/);
    expect(problemText(problem(422, "no-coverage"))).toMatch(/does not cover/);
    expect(problemText(problem(404, "not-found"))).toMatch(/not found/);
    expect(problemText(problem(401, "unauthenticated"))).toMatch(/Sign in again/);
    expect(problemText(problem(400, "validation"))).toMatch(/could not be read/);
    expect(problemText(problem(502, "upstream"))).toMatch(/did not answer/);
    expect(problemText(problem(500, "internal"))).toBe("Something went wrong. Try again.");
    expect(problemText(new TypeError("Failed to fetch"))).toMatch(/did not answer/);
    expect(problemText(problem(500, "internal"))).not.toContain("server detail text");
  });
});
