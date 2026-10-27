/**
 * Tests for the hatch pattern cache of the range matrix (S24, R3.12): one tile per key, built
 * once and reused across frames, "none" gives no overlay, and a missing 2D context degrades to
 * no pattern instead of a crash.
 */
import { describe, expect, it, vi } from "vitest";

import {
  MISSING_PATTERN_KEY,
  createPatternSource,
  patternKey,
  type PatternTarget,
  type TileCanvas,
  type TileContext,
} from "../../src/components/range-matrix/patterns.js";
import { fakePattern } from "./recording-context.js";

interface FakeTile extends TileCanvas {
  readonly strokes: number;
  readonly dots: number;
}

function tileFactory(withContext = true) {
  const tiles: FakeTile[] = [];
  const make = (size: number): FakeTile => {
    let strokes = 0;
    let dots = 0;
    const context: TileContext = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: () => {
        strokes += 1;
      },
      fillRect: () => {
        dots += 1;
      },
    };
    const tile = {
      width: size,
      height: size,
      getContext: () => (withContext ? context : null),
      get strokes() {
        return strokes;
      },
      get dots() {
        return dots;
      },
    };
    tiles.push(tile);
    return tile;
  };
  return { make, tiles };
}

function target(): PatternTarget<FakeTile> & { calls: number } {
  const state = {
    calls: 0,
    createPattern(tile: FakeTile) {
      state.calls += 1;
      return fakePattern(`tile-${tile.width}`);
    },
  };
  return state;
}

describe("R3.12 range matrix hatch patterns", () => {
  it("R3.12 builds one tile per key and reuses it on later frames", () => {
    const { make, tiles } = tileFactory();
    const host = target();
    const source = createPatternSource(host, "light", 2, make);
    const first = source.get(patternKey("diagonal", 0));
    const again = source.get(patternKey("diagonal", 0));
    expect(first).not.toBeNull();
    expect(again).toBe(first);
    expect(host.calls).toBe(1);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.strokes).toBeGreaterThan(0);
  });

  it("R3.12 a larger size variant gives a wider tile, so two sizes of one kind differ by spacing", () => {
    const { make, tiles } = tileFactory();
    const source = createPatternSource(target(), "dark", 1, make);
    source.get(patternKey("diagonal", 0));
    source.get(patternKey("diagonal", 1));
    expect(tiles).toHaveLength(2);
    expect(tiles[1]?.width).toBeGreaterThan(tiles[0]?.width ?? 0);
  });

  it("R3.12 draws every pattern kind and the missing hatch", () => {
    const { make, tiles } = tileFactory();
    const source = createPatternSource(target(), "light", 1, make);
    for (const pattern of ["diagonal", "reverse", "cross", "vertical", "horizontal", "dots"] as const) {
      expect(source.get(patternKey(pattern, 0))).not.toBeNull();
    }
    expect(source.get(MISSING_PATTERN_KEY)).not.toBeNull();
    expect(tiles.every((tile) => tile.strokes + tile.dots > 0)).toBe(true);
  });

  it("R3.12 the none pattern and an unknown key give no overlay", () => {
    const { make, tiles } = tileFactory();
    const source = createPatternSource(target(), "light", 1, make);
    expect(source.get(patternKey("none", 0))).toBeNull();
    expect(source.get("bogus:0")).toBeNull();
    expect(tiles).toHaveLength(0);
  });

  it("R3.12 a tile without a 2D context gives no pattern and is not retried every frame", () => {
    const { make } = tileFactory(false);
    const spy = vi.fn(make);
    const source = createPatternSource(target(), "light", 1, spy);
    expect(source.get(patternKey("dots", 0))).toBeNull();
    expect(source.get(patternKey("dots", 0))).toBeNull();
    expect(spy).toHaveBeenCalledOnce();
  });
});
