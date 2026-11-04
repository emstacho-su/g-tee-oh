/**
 * Study this spot (S46, R3.34, item 11): a graded decision links to the same node in Study. The
 * link names the decision's configuration through the configuration list (format, table size,
 * stake, depth), the pair, the hero's hand class and the line: the pair's own preflop tokens from
 * the prompt's history, which share solver-query's vocabulary with the study line (api
 * study/line-walk.ts). When the line cannot be read that way it falls back to the pair's root.
 */
import { describe, expect, it } from "vitest";

import type { TrainerPrompt } from "../../src/contracts.js";
import { fixtureFeedback, fixturePrompt } from "../../src/fixtures/index.js";
import { fixtureConfigs } from "../../src/fixtures/study.js";
import { parseSearchAsStrings } from "../../src/app/search-serialization.js";
import { validateStudySearch } from "../../src/study/search.js";
import { studyHrefFor, studyLineOf, studySearchFor } from "../../src/trainer/study-link.js";

type History = TrainerPrompt["history"];

const BB_VERSUS_OPEN: History = [
  { position: "UTG", token: "f", label: "Fold" },
  { position: "HJ", token: "f", label: "Fold" },
  { position: "CO", token: "f", label: "Fold" },
  { position: "BTN", token: "r250", label: "Raise to 2.5bb" },
  { position: "SB", token: "f", label: "Fold" },
];

describe("R3.34 the study line from the prompt's history", () => {
  it("R3.34 the pair's own tokens in order, the other seats' folds left out", () => {
    expect(studyLineOf(BB_VERSUS_OPEN, "BB-BTN", "preflop")).toBe("r250");
    const second: History = [...BB_VERSUS_OPEN, { position: "BB", token: "r1100", label: "Raise to 11bb" }, { position: "BTN", token: "r2400", label: "Raise to 24bb" }];
    expect(studyLineOf(second, "BB-BTN", "preflop")).toBe("r250.r1100.r2400");
  });

  it("R3.34 no token from the pair is the pair's root", () => {
    expect(studyLineOf(BB_VERSUS_OPEN.slice(0, 3), "BTN-BB", "preflop")).toBeUndefined();
  });

  it("R3.34 a seat outside the pair that did more than fold, or a postflop node, falls back to the root", () => {
    const limped: History = [{ position: "UTG", token: "c", label: "Limp" }, ...BB_VERSUS_OPEN.slice(1)];
    expect(studyLineOf(limped, "BB-BTN", "preflop")).toBeUndefined();
    expect(studyLineOf(BB_VERSUS_OPEN, "BB-BTN", "flop")).toBeUndefined();
    const postflopEntry: History = [...BB_VERSUS_OPEN, { position: "BB", token: "c", label: "Call", street: "flop" }];
    expect(studyLineOf(postflopEntry, "BB-BTN", "preflop")).toBeUndefined();
  });
});

describe("R3.34 the study search and link for a graded decision", () => {
  const prompt: TrainerPrompt = { ...fixturePrompt, history: BB_VERSUS_OPEN, street: "preflop" };

  it("R3.34 names the configuration's settings, the pair, the line and the hand class, all valid study search values", () => {
    const search = studySearchFor({ ...fixtureFeedback, hand: "AJo" }, prompt, fixtureConfigs);
    const config = fixtureConfigs.find((entry) => entry.config_id === fixtureFeedback.config_id);
    expect(config).toBeDefined();
    expect(search).toEqual({
      format: config?.format,
      table_size: config?.table_size,
      stake: config?.stake_id,
      depth: config?.depth_cbb,
      pair: fixtureFeedback.pair,
      line: "r250",
      hand: "AJo",
    });
    expect(validateStudySearch({ ...search })).toEqual(search);
  });

  it("R3.34 two hole cards become their hand class", () => {
    expect(studySearchFor({ ...fixtureFeedback, hand: "KsQs" }, prompt, fixtureConfigs)?.hand).toBe("KQs");
  });

  it("R3.34 a configuration the list does not hold gives no link", () => {
    expect(studySearchFor({ ...fixtureFeedback, config_id: "cfg_unknown" }, prompt, fixtureConfigs)).toBeNull();
  });

  it("R3.34 the link is /study with the search written as the router reads it back, a pair-like hand kept a string", () => {
    const search = studySearchFor({ ...fixtureFeedback, hand: "55" }, prompt, fixtureConfigs);
    if (search === null) throw new Error("no study search");
    const href = studyHrefFor(search);
    expect(href.startsWith("/study?")).toBe(true);
    expect(validateStudySearch(parseSearchAsStrings(href.slice("/study".length)))).toEqual(search);
  });
});
