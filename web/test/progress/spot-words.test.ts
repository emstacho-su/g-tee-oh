/**
 * One spot vocabulary for every screen (S47, R4.12, critic early finding a): action families,
 * position pairs, depth bands and configurations read as words wherever a class, a leak, a heat map
 * header, a queue row or a coverage heading names a spot; a raw token such as "rfi", "BB-BTN" or a
 * configuration key never reaches the screen.
 */
import { describe, expect, it } from "vitest";

import { fixtureHeatmap, fixtureLeaks } from "../../src/fixtures/progress.js";
import { fixtureConfigs } from "../../src/fixtures/study.js";
import { pairKeyOfText } from "../../src/drills/reach-model.js";
import { leakDrillName, pairSeats } from "../../src/progress/drill-family.js";
import { familyWords as frequencyFamilyWords } from "../../src/progress/frequency-model.js";
import { classLabel, columnLabel, rowLabel } from "../../src/progress/heatmap-model.js";
import { joinLeaksToCells } from "../../src/progress/leak-model.js";
import { buildHomeQueue } from "../../src/progress/queue-model.js";
import {
  capitalize,
  classWords,
  columnPhrase,
  columnWords,
  configurationWords,
  configurationWordsIn,
  depthBandLabel,
  drillActionWords,
  FAMILY_WORDS,
  familyWords,
  pairWords,
  parsePair,
  POSITION_WORDS,
  positionWords,
} from "../../src/progress/spot-words.js";
import type { GameConfig } from "../../src/progress/types.js";

const RAW_TOKEN = /\b(rfi|facing-open|facing-3bet|facing-4bet|blind-vs-blind|limped-isolation|straddled-pot)\b|\b[A-Z]{2,4}[0-9]?-[A-Z]{2,4}[0-9]?\b|cfg_[0-9]/;

describe("R4.12 one spot-vocabulary formatter serves classLabel, leak rows, heat map headers and the queue", () => {
  it("R4.12 every family, position and depth band the api names has words", () => {
    expect(familyWords("rfi")).toBe("open or fold");
    expect(familyWords("facing-open")).toBe("facing an open");
    expect(familyWords("facing-3bet")).toBe("facing a 3-bet");
    expect(familyWords("blind-vs-blind")).toBe("blind versus blind");
    expect(familyWords("limped-isolation")).toBe("isolating a limper");
    expect(familyWords("straddled-pot")).toBe("straddled pot");
    expect(familyWords(null)).toBe("preflop spot");
    expect(familyWords("something-new")).toBe("preflop spot");
    expect(Object.keys(FAMILY_WORDS).sort()).toEqual(["blind-vs-blind", "facing-3bet", "facing-4bet", "facing-open", "limped-isolation", "rfi", "squeeze", "straddled-pot"]);
    expect(Object.keys(POSITION_WORDS)).toEqual(["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"]);
    expect(positionWords("BB")).toBe("big blind");
    expect(positionWords("UTG1")).toBe("UTG+1");
    expect(positionWords("XX")).toBe("XX");
    expect(pairWords("BB-BTN")).toBe("big blind versus button");
    expect(pairWords("UTG-HJ")).toBe("under the gun versus hijack");
    expect(pairWords("not-a-pair-at-all")).toBe("not-a-pair-at-all");
    expect(depthBandLabel("100")).toBe("100bb");
    expect(depthBandLabel("deep")).toBe("deep");
    expect(capitalize("facing an open")).toBe("Facing an open");
    expect(capitalize("")).toBe("");
    // The drill builder's own action tokens read in words too (the Spot column, R3.14).
    expect(drillActionWords("rfi")).toBe("open or fold");
    expect(drillActionWords("vs_three_bet")).toBe("facing a 3-bet");
    expect(drillActionWords("three_bet")).toBe("3-betting");
  });

  it("R4.12 a class reads family, pair, format and depth in words, and the model labels are that one formatter", () => {
    const row = { family: "rfi", pair: "BB-UTG" };
    const column = { format: "live", depth_band: "100" };
    expect(classWords(row, column)).toBe("Open or fold, big blind versus under the gun, live 100bb");
    expect(classLabel(row, column)).toBe(classWords(row, column));
    expect(rowLabel(row)).toBe("Open or fold, big blind versus under the gun");
    expect(columnLabel(column)).toBe("Live 100bb");
    expect(classWords({ family: "facing-3bet", pair: "SB-BTN" }, { format: "online", depth_band: "short" })).toBe("Facing a 3-bet, small blind versus button, online short");
  });

  it("R4.12 one column phrase serves the class words, the queue's where and the heat map column (PR #48 review 4 finding 7)", () => {
    const column = { format: "live", depth_band: "100" };
    expect(columnPhrase(column)).toBe("live 100bb");
    expect(columnWords(column)).toBe(capitalize(columnPhrase(column)));
    expect(classWords({ family: "rfi", pair: "BB-UTG" }, column).endsWith(`, ${columnPhrase(column)}`)).toBe(true);
    const queue = buildHomeQueue(fixtureHeatmap, fixtureLeaks);
    for (const leak of queue.leaks) {
      const cell = fixtureHeatmap.cells.find((each) => each.spot_class_key === leak.spotClassKey);
      const leakColumn = cell === undefined ? undefined : fixtureHeatmap.columns[cell.column];
      if (leakColumn === undefined) throw new Error("a queued leak has no heat map column");
      expect(leak.where?.endsWith(`, ${columnPhrase(leakColumn)}`)).toBe(true);
    }
  });

  it("R4.12 leak rows, the queue card and the auto drill's name print no raw token", () => {
    const rows = joinLeaksToCells(fixtureLeaks, fixtureHeatmap);
    for (const row of rows) expect(row.label).not.toMatch(RAW_TOKEN);
    expect(rows[0]?.label).toBe("Open or fold, big blind versus under the gun, live 100bb");
    const queue = buildHomeQueue(fixtureHeatmap, fixtureLeaks);
    for (const leak of queue.leaks) {
      expect(leak.family).not.toMatch(RAW_TOKEN);
      expect(leak.where).not.toMatch(RAW_TOKEN);
    }
    expect(queue.leaks[0]).toMatchObject({ family: "Open or fold", where: "big blind versus under the gun, live 100bb" });
    expect(leakDrillName({ family: "rfi", pair: "BB-UTG", format: "live", depthBand: "100" })).toBe("Leak drill: open or fold, big blind versus under the gun, live 100bb");
    // The frequency card's family words are the same map, re-exported.
    expect(frequencyFamilyWords).toBe(familyWords);
  });

  it("R4.12 a configuration reads by its catalog label, and by a plain sentence when the catalog does not list it", () => {
    const config = fixtureConfigs[0] as GameConfig;
    expect(configurationWords(config)).toBe("Online, 6 players, 100bb deep");
    expect(configurationWords(undefined)).toBe("a configuration the catalog does not list");
    expect(configurationWords(undefined)).not.toMatch(RAW_TOKEN);
    expect(configurationWords(undefined, "cfg_6_online_999")).toBe("Online, 6 players, 999bb deep, not in the catalog");
    expect(configurationWords(undefined, "cfg_6_online_999", true)).toBe("configuration loading");
    expect(configurationWords(undefined, "not-a-config")).toBe("not-a-config");
  });

  it("R4.12 a configuration id reads through the list it is looked up in: its label, loading while the list is, its own facets when unlisted (PR #48 review 4 finding 4)", () => {
    const config = fixtureConfigs[0] as GameConfig;
    expect(configurationWordsIn(fixtureConfigs, config.config_id)).toBe("Online, 6 players, 100bb deep");
    expect(configurationWordsIn(undefined, config.config_id)).toBe("configuration loading");
    expect(configurationWordsIn(fixtureConfigs, "cfg_6_online_999")).toBe("Online, 6 players, 999bb deep, not in the catalog");
  });

  it("R4.12 one pair split serves the words, the reach keys and the coverage events (PR #48 review round 2 LOW 9)", () => {
    expect(parsePair("BB-BTN")).toEqual(["BB", "BTN"]);
    expect(parsePair("SB-BB-BTN")).toBeNull();
    expect(parsePair("BB-")).toBeNull();
    expect(parsePair("not a pair")).toBeNull();
    expect(pairKeyOfText("BTN-BB")).toBe(pairKeyOfText("BB-BTN"));
    expect(pairKeyOfText("BB")).toBeNull();
    expect(pairSeats("BB-BTN")).toEqual(["BB", "BTN"]);
    expect(pairSeats("BB-BB")).toBeNull();
  });
});
