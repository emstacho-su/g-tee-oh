/** Tests for tokenActionLabel, the plain name of an action token (S38, R3.12, ADR 0004). */
import { describe, expect, it } from "vitest";

import { exactActionLabel, sizedActionLabel } from "../../src/poker/format.js";
import { tokenActionLabel } from "../../src/poker/token-label.js";

describe("R3.12 sizedActionLabel and exactActionLabel", () => {
  it("R3.12 one all-in rule, in sizedActionLabel, the place every label passes through: an all-in prints without its size, as the api's own label does (PR 52 review round 2, settled in code review round 1, 9)", () => {
    expect(sizedActionLabel("all_in", 10000)).toBe("All-in");
    expect(sizedActionLabel("all_in", null)).toBe("All-in");
    expect(tokenActionLabel("a")).toBe("All-in");
    expect(exactActionLabel({ index: 3, kind: "all_in", token: "r10000", label: "All-in", size_cbb: 10000, bucket: "all-in", next_node_key: null })).toBe("All-in");
    expect(exactActionLabel({ index: 2, kind: "raise", token: "r250", label: "Raise to 2.5bb", size_cbb: 250, bucket: "pot", next_node_key: null })).toBe("Raise to 2.5bb");
  });
});

describe("R3.12 tokenActionLabel", () => {
  it("R3.12 names the unsized tokens", () => {
    expect(tokenActionLabel("f")).toBe("Fold");
    expect(tokenActionLabel("x")).toBe("Check");
    expect(tokenActionLabel("c")).toBe("Call");
    expect(tokenActionLabel("l")).toBe("Limp");
    expect(tokenActionLabel("a")).toBe("All-in");
  });

  it("R3.12 names sized tokens with the size in big blinds, the way exactActionLabel does", () => {
    expect(tokenActionLabel("r250")).toBe("Raise to 2.5bb");
    expect(tokenActionLabel("b250")).toBe("Bet 2.5bb");
    expect(tokenActionLabel("s200")).toBe("Straddle 2bb");
    expect(tokenActionLabel("r10000")).toBe("Raise to 100bb");
  });

  it("R3.12 returns null for text that is not a token, never a guess", () => {
    for (const text of ["", "r", "r0", "r025", "q100", "f1", "rr250", "r2.5", " r250", "constructor", "toString"]) {
      expect(tokenActionLabel(text)).toBeNull();
    }
  });
});
