/** Tests for tokenActionLabel, the plain name of an action token (S38, R3.12, ADR 0004). */
import { describe, expect, it } from "vitest";

import { tokenActionLabel } from "../../src/poker/token-label.js";

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
