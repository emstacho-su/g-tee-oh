/**
 * Tests for the right column's tab rules (S45 follow-up, R3.26, item 10): which tabs a node has (a
 * tab exists only when it has data), which tab a street-specific badge marks, the `view` address
 * parameter, the tab that shows (the address, else the browser's last tab, else Overview, falling
 * back when the chosen one has no data here) and the per-browser seed under gto-study-view.
 */
import { describe, expect, it } from "vitest";

import { fixtureStudyNode } from "../../src/fixtures/index.js";
import { STUDY_VIEW_STORAGE_KEY } from "../../src/store/preference-keys.js";
import { readStudyView, writeStudyView } from "../../src/store/study-view.js";
import { validateStudySearch } from "../../src/study/search.js";
import { STUDY_VIEWS, availableViews, shownView, viewBadge } from "../../src/study/study-views.js";
import { memoryStorage, throwingStorage } from "../support/storage.js";

const FOLD_ONLY = { ...fixtureStudyNode, actions: fixtureStudyNode.actions.slice(0, 1), hands: fixtureStudyNode.hands.map((row) => ({ ...row, strategy: [1], ev_bb: [0], loss_pct_pot: [0] })) };
const NO_ROWS = { ...fixtureStudyNode, hands: [] };

describe("R3.26 which tabs a node has", () => {
  it("R3.26 the three views in order", () => {
    expect(STUDY_VIEWS).toEqual(["overview", "hands", "compare"]);
  });

  it("R3.26 a node with hand rows and an action other than fold has all three", () => {
    expect(availableViews(fixtureStudyNode)).toEqual(["overview", "hands", "compare"]);
  });

  it("R3.26 a fold-only node has no Compare tab, and a node with no hand rows only Overview", () => {
    expect(availableViews(FOLD_ONLY)).toEqual(["overview", "hands"]);
    expect(availableViews(NO_ROWS)).toEqual(["overview"]);
  });

  it("R3.26 the Hands tab is street-specific and carries the node's street as its badge; the others carry none", () => {
    expect(viewBadge("hands", "preflop")).toBe("Preflop");
    expect(viewBadge("hands", "flop")).toBe("Flop");
    expect(viewBadge("overview", "preflop")).toBeUndefined();
    expect(viewBadge("compare", "preflop")).toBeUndefined();
  });
});

describe("R3.26 the tab that shows", () => {
  it("R3.26 the address wins, then the browser's last tab, then Overview", () => {
    expect(shownView(fixtureStudyNode, "compare", "hands")).toBe("compare");
    expect(shownView(fixtureStudyNode, undefined, "hands")).toBe("hands");
    expect(shownView(fixtureStudyNode, undefined, null)).toBe("overview");
  });

  it("R3.26 a tab with no data at this node falls back to Overview", () => {
    expect(shownView(FOLD_ONLY, "compare", null)).toBe("overview");
    expect(shownView(NO_ROWS, undefined, "hands")).toBe("overview");
  });

  it("R3.26 the view parameter keeps the three views and drops anything else", () => {
    expect(validateStudySearch({ view: "hands" })).toEqual({ view: "hands" });
    expect(validateStudySearch({ view: "breakdown" })).toEqual({});
  });
});

describe("R3.26 the per-browser seed", () => {
  it("R3.26 reads and writes gto-study-view, validated, and survives a throwing storage", () => {
    const storage = memoryStorage();
    expect(readStudyView(storage)).toBeNull();
    writeStudyView("compare", storage);
    expect(JSON.parse(storage.getItem(STUDY_VIEW_STORAGE_KEY) ?? "null")).toBe("compare");
    expect(readStudyView(storage)).toBe("compare");
    storage.setItem(STUDY_VIEW_STORAGE_KEY, JSON.stringify("breakdown"));
    expect(readStudyView(storage)).toBeNull();
    expect(readStudyView(throwingStorage())).toBeNull();
    expect(() => writeStudyView("hands", throwingStorage())).not.toThrow();
  });
});
