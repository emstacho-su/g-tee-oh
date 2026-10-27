/**
 * Hatch patterns for the range matrix canvas, cached per theme and pixel ratio (S24, R3.12).
 *
 * Mechanism: A7 section 4 says color is never the only signal, so every action bar is overlaid
 * with its kind's hatch pattern from src/theme/action-style.ts (diagonal for bets and raises,
 * dots for calls and checks, cross for all-in and so on). A pattern is a small transparent tile
 * with a few strokes in the theme's hatch ink, turned into a repeating CanvasPattern once and
 * kept in a map, so a frame only looks patterns up and never allocates one. The key is the
 * pattern name plus a size variant: the second and later sizes of a bet or raise at one node get
 * a wider spacing, so two raise sizes differ by spacing as well as by shade. Missing hands use
 * their own gray hatch. The tile maker is injected (a canvas element in the browser, a fake in
 * tests); a tile without a 2D context yields no pattern, remembered so it is not retried.
 */
import type { HatchPattern, ThemeName } from "../../theme/action-style.js";
import { MATRIX_PALETTES } from "./matrix-theme.js";

export interface PatternSource {
  /** The overlay for a key from patternKey or MISSING_PATTERN_KEY; null means draw no overlay. */
  get(key: string): CanvasPattern | null;
}

/** The slice of a 2D context a tile is drawn with. */
export interface TileContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
}

export interface TileCanvas {
  width: number;
  height: number;
  getContext(contextId: "2d"): TileContext | null;
}

/** What turns a tile into a repeating pattern: the matrix's own 2D context in the browser. */
export interface PatternTarget<T> {
  createPattern(image: T, repetition: "repeat"): CanvasPattern | null;
}

export const MISSING_PATTERN_KEY = "missing:0";

const BASE_SPACING_PX = 6;
const VARIANT_SPACING_PX = 3;
const LINE_WIDTH_PX = 1;
const DOT_SIZE_PX = 2;
const DRAWN_PATTERNS: ReadonlySet<string> = new Set(["diagonal", "reverse", "cross", "vertical", "horizontal", "dots", "missing"]);

export function patternKey(pattern: HatchPattern, variant: number): string {
  return `${pattern}:${variant}`;
}

function parseKey(key: string): { pattern: string; variant: number } | null {
  const [pattern, variantText] = key.split(":");
  const variant = Number(variantText);
  if (pattern === undefined || !DRAWN_PATTERNS.has(pattern) || !Number.isInteger(variant) || variant < 0) return null;
  return { pattern, variant };
}

function line(context: TileContext, fromX: number, fromY: number, toX: number, toY: number): void {
  context.beginPath();
  context.moveTo(fromX, fromY);
  context.lineTo(toX, toY);
  context.stroke();
}

/** Strokes one tile of a pattern; diagonals run corner to corner so the tiles join seamlessly. */
function drawTile(context: TileContext, pattern: string, size: number, pixelRatio: number): void {
  const half = size / 2;
  if (pattern === "dots") {
    const dot = Math.max(1, Math.round(DOT_SIZE_PX * pixelRatio));
    context.fillRect(Math.floor(half - dot / 2), Math.floor(half - dot / 2), dot, dot);
    return;
  }
  if (pattern === "diagonal" || pattern === "cross" || pattern === "missing") line(context, 0, size, size, 0);
  if (pattern === "reverse" || pattern === "cross") line(context, 0, 0, size, size);
  if (pattern === "vertical") line(context, half, 0, half, size);
  if (pattern === "horizontal") line(context, 0, half, size, half);
}

export function createPatternSource<T extends TileCanvas>(
  target: PatternTarget<T>,
  theme: ThemeName,
  pixelRatio: number,
  makeTile: (sizePx: number) => T,
): PatternSource {
  const palette = MATRIX_PALETTES[theme];
  const cache = new Map<string, CanvasPattern | null>();

  function build(key: string): CanvasPattern | null {
    const parsed = parseKey(key);
    if (parsed === null) return null;
    const size = Math.round((BASE_SPACING_PX + parsed.variant * VARIANT_SPACING_PX) * pixelRatio);
    const tile = makeTile(size);
    const context = tile.getContext("2d");
    if (context === null) return null;
    const ink = parsed.pattern === "missing" ? palette.missingInk : palette.hatchInk;
    context.strokeStyle = ink;
    context.fillStyle = ink;
    context.lineWidth = Math.max(1, LINE_WIDTH_PX * pixelRatio);
    drawTile(context, parsed.pattern, size, pixelRatio);
    return target.createPattern(tile, "repeat");
  }

  return {
    get(key) {
      if (cache.has(key)) return cache.get(key) ?? null;
      const pattern = build(key);
      cache.set(key, pattern);
      return pattern;
    },
  };
}

/** The browser tile maker: a detached canvas element of the given size in device pixels. */
export function canvasTile(sizePx: number): HTMLCanvasElement {
  const tile = document.createElement("canvas");
  tile.width = sizePx;
  tile.height = sizePx;
  return tile;
}
