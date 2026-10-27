/**
 * A recording fake of the 2D canvas context for the range matrix draw tests (S24, R3.12). It
 * keeps every fill, stroke and text call with the style that was current at the call, so a test
 * can assert what was painted where without a real canvas (jsdom has none). Fake patterns are
 * plain objects tagged with their cache key.
 */
import type { MatrixCanvasContext } from "../../src/components/range-matrix/draw.js";
import type { PatternSource } from "../../src/components/range-matrix/patterns.js";

export interface FakePattern extends CanvasPattern {
  readonly patternKey: string;
}

export type RecordedOp =
  | { op: "fillRect"; x: number; y: number; w: number; h: number; style: unknown }
  | { op: "strokeRect"; x: number; y: number; w: number; h: number; style: unknown; lineWidth: number }
  | { op: "clearRect"; x: number; y: number; w: number; h: number }
  | { op: "fillText"; text: string; x: number; y: number; style: unknown; font: string };

export interface RecordingContext {
  readonly ctx: MatrixCanvasContext;
  readonly ops: RecordedOp[];
}

export function recordingContext(): RecordingContext {
  const ops: RecordedOp[] = [];
  const ctx: MatrixCanvasContext = {
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    fillRect(x, y, w, h) {
      ops.push({ op: "fillRect", x, y, w, h, style: this.fillStyle });
    },
    strokeRect(x, y, w, h) {
      ops.push({ op: "strokeRect", x, y, w, h, style: this.strokeStyle, lineWidth: this.lineWidth });
    },
    clearRect(x, y, w, h) {
      ops.push({ op: "clearRect", x, y, w, h });
    },
    fillText(text, x, y) {
      ops.push({ op: "fillText", text, x, y, style: this.fillStyle, font: this.font });
    },
  };
  return { ctx, ops };
}

export function fakePattern(patternKey: string): FakePattern {
  return { patternKey, setTransform: () => undefined };
}

export function isFakePattern(value: unknown): value is FakePattern {
  return typeof value === "object" && value !== null && "patternKey" in value;
}

/** A pattern source that hands out one tagged fake per key, cached like the real one. */
export function fakePatternSource(): PatternSource & { readonly requested: string[] } {
  const cache = new Map<string, FakePattern>();
  const requested: string[] = [];
  return {
    requested,
    get(key) {
      requested.push(key);
      const known = cache.get(key);
      if (known !== undefined) return known;
      const created = fakePattern(key);
      cache.set(key, created);
      return created;
    },
  };
}
