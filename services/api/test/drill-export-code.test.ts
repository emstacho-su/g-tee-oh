/**
 * The drill export code in isolation (R3.14, O-310, O-26, O-235). The code is g-tee-oh's own
 * encoding: the "gteeoh1." prefix, then base64url of the zlib-deflated canonical JSON of the
 * drill's name, tags, spot filter and trainer settings. Import is user input, so every guard is
 * tested here: the length cap before any decoding, malformed base64url, a wrong version prefix,
 * zlib's own output cap against a compression bomb, unknown keys and the drill write rules.
 */
import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  decodeExportCode,
  encodeExportCode,
  EXPORT_CODE_PREFIX,
  ExportCodeError,
  MAX_EXPORT_CODE_LENGTH,
  MAX_INFLATED_BYTES,
} from "../src/drills/export-code.js";
import type { DrillCreateBody } from "../src/schemas/drills.js";

const RFI: DrillCreateBody = {
  name: "BTN RFI boundary hands",
  tags: ["rfi", "boundary"],
  spot_filter: {
    game_config: { format: "online", table_size: 6, depths_bb: [100] },
    stake: "online",
    sizing: { mode: "convention" },
    start_street: "preflop",
    hero_positions: ["BTN"],
    villain_positions: [],
    preflop_action: ["rfi"],
    hands: { mode: "close_decisions" },
    alternate_seats: false,
  },
  trainer: {
    stop_rule: "after_action",
    input: "actions",
    grouping: "standard",
    rng: false,
    pause: "after_mistake",
    speed: "normal",
    quick_result: false,
    tables: 1,
    timebank_s: null,
    panels: { hero_range_matrix: true },
  },
};

const FULL: DrillCreateBody = {
  name: "CO vs BTN three-bet pots, full hand",
  tags: ["three-bet", "co_btn"],
  spot_filter: {
    game_config: { format: "live", table_size: 9, depths_bb: [100, 150] },
    stake: "1/3",
    sizing: { mode: "fixed", open_bb: 4, three_bet_bb: 12 },
    start_street: "preflop",
    hero_positions: ["CO"],
    villain_positions: ["BTN"],
    preflop_action: ["three_bet", "vs_three_bet"],
    line: "r400.r1200.c",
    board: { high_card: "K", paired: false, suits: "rainbow", connectivity: "disconnected", flops: ["Kh7d2c"] },
    hands: { mode: "manual", hands: ["AKs", "QQ", "T9o"] },
    alternate_seats: true,
  },
  trainer: {
    stop_rule: "end_of_hand",
    input: "frequency",
    grouping: "grouped",
    rng: true,
    pause: "every_action",
    speed: "fast",
    quick_result: true,
    tables: 2,
    timebank_s: 15,
    panels: { hero_range_matrix: true, rng_roller: false, streak_counter: true },
  },
};

function codeOf(payload: unknown): string {
  return `${EXPORT_CODE_PREFIX}${deflateSync(Buffer.from(JSON.stringify(payload), "utf8")).toString("base64url")}`;
}

function failure(code: string): ExportCodeError {
  try {
    decodeExportCode(code);
  } catch (error: unknown) {
    if (error instanceof ExportCodeError) {
      return error;
    }
    throw error;
  }
  throw new Error("the code decoded");
}

describe("R3.14 drill export code (O-310)", () => {
  it.each([
    ["an RFI drill", RFI],
    ["a drill using every field", FULL],
  ])("R3.14 export then import of %s round-trips equal to the original", (_name, drill) => {
    const code = encodeExportCode(drill);
    expect(code.startsWith(EXPORT_CODE_PREFIX)).toBe(true);
    expect(code.length).toBeLessThanOrEqual(MAX_EXPORT_CODE_LENGTH);
    expect(decodeExportCode(code)).toEqual(drill);
  });

  it("R3.14 the code is deterministic whatever order the keys were written in", () => {
    const reordered = { trainer: RFI.trainer, spot_filter: RFI.spot_filter, tags: RFI.tags, name: RFI.name };
    expect(encodeExportCode(reordered)).toBe(encodeExportCode(RFI));
  });

  it("R3.14 the code carries only base64url text after its prefix", () => {
    const body = encodeExportCode(FULL).slice(EXPORT_CODE_PREFIX.length);
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("R3.14 a code over the length cap is refused before any decoding", () => {
    const error = failure(`${EXPORT_CODE_PREFIX}${"A".repeat(MAX_EXPORT_CODE_LENGTH)}`);
    expect(error.reason).toBe("too_long");
  });

  it.each([
    ["no prefix", "eJxLTEoGAAJNASc"],
    ["another version", "gteeoh2.eJxLTEoGAAJNASc"],
    ["another tool's prefix shape", "abc:eJxLTEoGAAJNASc"],
  ])("R3.14 a code with %s is refused as a wrong version", (_name, code) => {
    expect(failure(code).reason).toBe("version");
  });

  it.each([
    ["characters outside base64url", `${EXPORT_CODE_PREFIX}abc+/=`],
    ["an empty body", EXPORT_CODE_PREFIX],
    ["a body of one character", `${EXPORT_CODE_PREFIX}A`],
  ])("R3.14 a code with %s is refused as malformed", (_name, code) => {
    expect(failure(code).reason).toBe("malformed");
  });

  it("R3.14 base64url that is not zlib data is refused as malformed", () => {
    expect(failure(`${EXPORT_CODE_PREFIX}${Buffer.from("not zlib at all").toString("base64url")}`).reason).toBe("malformed");
  });

  it("R3.14 a compression bomb is stopped by zlib's output cap", () => {
    const bomb = deflateSync(Buffer.alloc(MAX_INFLATED_BYTES * 16, 0x20), { level: 9 });
    const code = `${EXPORT_CODE_PREFIX}${bomb.toString("base64url")}`;
    expect(code.length).toBeLessThanOrEqual(MAX_EXPORT_CODE_LENGTH);
    expect(failure(code).reason).toBe("too_large");
  });

  it("R3.14 inflated text that is not JSON is refused as malformed", () => {
    const code = `${EXPORT_CODE_PREFIX}${deflateSync(Buffer.from("{not json", "utf8")).toString("base64url")}`;
    expect(failure(code).reason).toBe("malformed");
  });

  it("R3.14 an unknown top-level key is refused", () => {
    const error = failure(codeOf({ ...RFI, owner: "someone" }));
    expect(error.reason).toBe("invalid");
    expect(error.issues.map((issue) => issue.path)).toContain("");
  });

  it("R3.14 an unknown key inside the spot filter is refused", () => {
    const error = failure(codeOf({ ...RFI, spot_filter: { ...RFI.spot_filter, extra: 1 } }));
    expect(error.reason).toBe("invalid");
    expect(error.issues.some((issue) => issue.path.startsWith("spot_filter"))).toBe(true);
  });

  it("R3.14 a payload breaking a drill write rule is refused with the rule's path", () => {
    const error = failure(codeOf({ ...RFI, spot_filter: { ...RFI.spot_filter, villain_positions: ["BTN"] } }));
    expect(error.reason).toBe("invalid");
    expect(error.issues.some((issue) => issue.path.startsWith("spot_filter"))).toBe(true);
  });

  it("R3.14 a JSON array payload is refused", () => {
    expect(failure(codeOf([RFI])).reason).toBe("invalid");
  });
});
