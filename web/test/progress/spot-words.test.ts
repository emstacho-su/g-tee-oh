/**
 * One spot vocabulary for every screen (S47, R4.12, critic early finding a): action families,
 * position pairs, depth bands and configurations read as words wherever a class, a leak, a heat map
 * header, a queue row or a coverage heading names a spot; a raw token such as "rfi", "BB-BTN" or a
 * configuration key never reaches the screen.
 */
import { describe, expect, it } from "vitest";

import { fixtureHeatmap, fixtureLeaks } from "../../src/fixtures/progress.js";
import { fixtureConfigs } from "../../src/fixtures/study.js";
import { leakDrillName } from "../../src/progress/drill-family.js";
import { familyWords as frequencyFamilyWords } from "../../src/progress/frequency-model.js";
import { classLabel, columnLabel, rowLabel } from "../../src/progress/heatmap-model.js";
import { joinLeaksToCells } from "../../src/progress/leak-model.js";
import { buildHomeQueue } from "../../src/progress/queue-model.js";
import {
  capitalize,
  classWords,
  configurationWords,
  depthBandLabel,
  drillActionWords,
  FAMILY_WORDS,
  familyWords,
  pairWords,
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
    expect(depthBandLabel("100")).toBe("100 bb");
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
    expect(classWords(row, column)).toBe("Open or fold, big blind versus under the gun, live 100 bb");
    expect(classLabel(row, column)).toBe(classWords(row, column));
    expect(rowLabel(row)).toBe("Open or fold, big blind versus under the gun");
    expect(columnLabel(column)).toBe("Live 100 bb");
    expect(classWords({ family: "facing-3bet", pair: "SB-BTN" }, { format: "online", depth_band: "short" })).toBe("Facing a 3-bet, small blind versus button, online short");
  });

  it("R4.12 leak rows, the queue card and the auto drill's name print no raw token", () => {
    const rows = joinLeaksToCells(fixtureLeaks, fixtureHeatmap);
    for (const row of rows) expect(row.label).not.toMatch(RAW_TOKEN);
    expect(rows[0]?.label).toBe("Open or fold, big blind versus under the gun, live 100 bb");
    const queue = buildHomeQueue(fixtureHeatmap, fixtureLeaks);
    for (const leak of queue.leaks) {
      expect(leak.family).not.toMatch(RAW_TOKEN);
      expect(leak.where).not.toMatch(RAW_TOKEN);
    }
    expect(queue.leaks[0]).toMatchObject({ family: "Open or fold", where: "big blind versus under the gun, live 100 bb" });
    expect(leakDrillName({ family: "rfi", pair: "BB-UTG", format: "live", depthBand: "100" })).toBe("Leak drill: open or fold, big blind versus under the gun, live 100 bb");
    // The frequency card's family words are the same map, re-exported.
    expect(frequencyFamilyWords).toBe(familyWords);
  });

  it("R4.12 a configuration reads by its catalog label, and by a plain sentence when the catalog does not list it", () => {
    const config = fixtureConfigs[0] as GameConfig;
    expect(configurationWords(config, config.config_id)).toBe("Online, 6 players, 100 bb deep, stakes online");
    expect(configurationWords(undefined, "cfg_6_online_999")).toBe("a configuration the catalog does not list");
    expect(configurationWords(undefined, "cfg_6_online_999")).not.toMatch(RAW_TOKEN);
  });
});
