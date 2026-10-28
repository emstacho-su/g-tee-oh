/**
 * More info templates (R3.19, O-309, 05 section 10.1, ADR 0004): the five sections are pure
 * renderings of the grounding with fixed rounding (bb two decimals, percent one decimal). The
 * number-membership test reads every number out of every section by a simple extraction that does
 * not use the validator, and requires each to be a grounding value or 100 times one at the shown
 * precision; the validator must agree. One snapshot per template pins the wording.
 */
import { describe, expect, it } from "vitest";

import { formatBb, formatPct } from "../src/explain/format.js";
import { buildGrounding } from "../src/explain/grounding.js";
import { MORE_INFO_TEMPLATES, renderMoreInfo } from "../src/explain/templates.js";
import { validateAnswer } from "../src/explain/validator.js";
import { SOURCES_55, SOURCES_55_BARE } from "./support/explain-sources.js";
import { unsupportedBySimpleExtraction } from "./support/number-membership.js";

describe("R3.19 format", () => {
  it("R3.19 bb has two decimals and never shows a negative zero", () => {
    expect(formatBb(0.6503091)).toBe("0.65");
    expect(formatBb(-0.00009091415)).toBe("0.00");
    expect(formatBb(-1.234)).toBe("-1.23");
  });

  it("R3.19 percent has one decimal, from a percent value or from a share", () => {
    expect(formatPct(16.26, "percent")).toBe("16.3");
    expect(formatPct(0.5019608, "share")).toBe("50.2");
    expect(formatPct(-0.0000001, "share")).toBe("0.0");
  });
});

describe("R3.19 More info templates", () => {
  const groundings = [
    ["the 55 grounding", buildGrounding(SOURCES_55)],
    ["the grounding with no optional insight cards", buildGrounding(SOURCES_55_BARE)],
  ] as const;

  it("R3.19 renders the five sections in scaffold order with a title and text each", () => {
    const sections = renderMoreInfo(buildGrounding(SOURCES_55).grounding);
    expect(sections.map((section) => section.template)).toEqual([...MORE_INFO_TEMPLATES]);
    for (const section of sections) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.text.length).toBeGreaterThan(0);
    }
  });

  for (const [name, bundle] of groundings) {
    it(`R3.19 every number in every template is in ${name} (simple extraction)`, () => {
      for (const section of renderMoreInfo(bundle.grounding)) {
        expect(unsupportedBySimpleExtraction(section.text, bundle), section.template).toEqual([]);
      }
    });

    it(`R3.19 the validator accepts every template over ${name}`, () => {
      for (const section of renderMoreInfo(bundle.grounding)) {
        expect(validateAnswer(section.text, bundle), section.template).toEqual({
          ok: true,
          unsupportedNumbers: [],
          unsupportedNames: [],
        });
      }
    });
  }

  it("R3.19 the simple extraction catches a planted number, so the membership test can fail", () => {
    const bundle = buildGrounding(SOURCES_55);
    expect(unsupportedBySimpleExtraction("Call earns 7.31 bb.", bundle)).toEqual(["7.31"]);
  });

  for (const section of renderMoreInfo(buildGrounding(SOURCES_55).grounding)) {
    it(`R3.19 the ${section.template} template matches its snapshot`, () => {
      expect(section).toMatchSnapshot();
    });
  }

  it("R3.19 the in-position, postflop and missing-name branches still render only grounded numbers", () => {
    const card = SOURCES_55.insights.threshold_card;
    if (card === null || card === undefined) {
      throw new Error("the fixture has a threshold card");
    }
    const bundle = buildGrounding({
      ...SOURCES_55,
      node: { ...SOURCES_55.node, to_act: "BTN", street: "flop" },
      insights: {
        ...SOURCES_55.insights,
        hand_role: null,
        threshold_card: {
          ...card,
          strongest_folding_hand: null,
          actions: card.actions.map((action) => ({ ...action, weakest_hand_taking_half: null })),
        },
      },
    });
    const sections = renderMoreInfo(bundle.grounding);
    const text = sections.map((section) => section.text).join("\n");
    expect(text).toContain("BTN plays the rest of the hand in position");
    expect(text).toContain("not part of this explanation yet");
    expect(text).toContain("gives no hand role");
    expect(text).toContain("at least half the time is no hand");
    for (const section of sections) {
      expect(validateAnswer(section.text, bundle).ok, section.template).toBe(true);
      expect(unsupportedBySimpleExtraction(section.text, bundle), section.template).toEqual([]);
    }
  });

  it("R3.19 a role the sentence table does not know is shown as Rust names it", () => {
    const bundle = buildGrounding({ ...SOURCES_55, insights: { ...SOURCES_55.insights, hand_role: "value" } });
    expect(renderMoreInfo(bundle.grounding)[2]?.text).toContain("a value hand");
    const unknown = { ...bundle.grounding, hand_role: "bluff_catcher" };
    expect(renderMoreInfo(unknown)[2]?.text).toContain("here as bluff_catcher.");
  });

  it("R3.19 the templates do not change the grounding", () => {
    const bundle = buildGrounding(SOURCES_55);
    const before = JSON.stringify(bundle.grounding);
    renderMoreInfo(bundle.grounding);
    expect(JSON.stringify(bundle.grounding)).toBe(before);
    expect(Object.isFrozen(bundle.grounding)).toBe(true);
  });
});

describe("R3.19 grounding", () => {
  it("R3.19 holds only Rust numbers and names, with the names and numbers sets", () => {
    const bundle = buildGrounding(SOURCES_55);
    expect(bundle.grounding.hand).toBe("5h5d");
    expect(bundle.grounding.hand_class).toBe("55");
    expect(bundle.grounding.position).toBe("BB");
    expect(bundle.grounding.opponent).toBe("BTN");
    expect(bundle.grounding.chosen).toEqual({ label: "Fold", ev_loss_bb: 0.6504, ev_loss_pct_pot: 16.26 });
    expect(bundle.grounding.best_actions).toEqual(["Call"]);
    expect([...bundle.names]).toEqual(expect.arrayContaining(["5h5d", "5h", "5d", "55", "KTs", "44", "A5o", "A5", "K5s"]));
    expect(bundle.labels).toEqual(expect.arrayContaining(["Fold", "Call", "Raise to 10bb", "BB", "BTN"]));
    expect(bundle.numbers).toEqual(expect.arrayContaining([0.5019608, 16.26, 21, 0.13138142, -10.5785]));
  });

  it("R3.19 the canonical text sorts keys, so equal groundings hash equally", () => {
    const one = buildGrounding(SOURCES_55);
    const two = buildGrounding({ ...SOURCES_55, insights: { ...SOURCES_55.insights } });
    expect(one.canonical).toBe(two.canonical);
    expect(one.canonical.startsWith('{"actions":')).toBe(true);
  });

  it("R3.19 without stored best actions the best are the node row's zero-loss actions", () => {
    expect(buildGrounding(SOURCES_55_BARE).grounding.best_actions).toEqual(["Call"]);
  });

  it("R3.19 a node without the attempt's hand row is refused", () => {
    expect(() => buildGrounding({ ...SOURCES_55, node: { ...SOURCES_55.node, hands: [] } })).toThrow(/no row/);
  });
});
