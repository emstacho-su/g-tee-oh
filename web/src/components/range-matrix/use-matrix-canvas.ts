/**
 * Redraws the range matrix canvas when its inputs change (S24, R3.12, O-260).
 *
 * Mechanism: one effect per change of the model, mode, size, pixel ratio, theme, focus, selection,
 * lens or scaling schedules exactly one requestAnimationFrame that draws the whole matrix, and the
 * cleanup cancels a frame that has not run yet, so a burst of changes inside one frame costs one
 * draw. The 2D context is asked for once per canvas; when the browser has none (jsdom, or a
 * locked-down browser) the frame is skipped and the table fallback is still there. The hatch
 * pattern cache is rebuilt only when the theme or pixel ratio changes, never per frame.
 */
import { useEffect, useRef, type RefObject } from "react";

import type { ThemeName } from "../../theme/action-style.js";
import { drawMatrix, type DrawOptions } from "./draw.js";
import type { MatrixModel } from "./model.js";
import { canvasTile, createPatternSource, type PatternSource } from "./patterns.js";

export type CanvasSettings = Omit<DrawOptions, "patterns">;

interface PatternCacheEntry {
  readonly theme: ThemeName;
  readonly pixelRatio: number;
  readonly source: PatternSource;
}

function patternsFor(
  cache: { current: PatternCacheEntry | null },
  ctx: CanvasRenderingContext2D,
  theme: ThemeName,
  pixelRatio: number,
): PatternSource {
  const known = cache.current;
  if (known !== null && known.theme === theme && known.pixelRatio === pixelRatio) return known.source;
  const source = createPatternSource<HTMLCanvasElement>(ctx, theme, pixelRatio, canvasTile);
  cache.current = { theme, pixelRatio, source };
  return source;
}

export function useMatrixCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  model: MatrixModel,
  settings: CanvasSettings,
): void {
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const patternRef = useRef<PatternCacheEntry | null>(null);
  const { mode, sizePx, pixelRatio, theme, focusedIndex, selectedHand, scaleByWeight = false, lensPosition = null, hoveredIndex = null } = settings;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const frame = window.requestAnimationFrame(() => {
      contextRef.current ??= canvas.getContext("2d");
      const ctx = contextRef.current;
      if (ctx === null) return;
      const patterns = patternsFor(patternRef, ctx, theme, pixelRatio);
      drawMatrix(ctx, model, { mode, sizePx, pixelRatio, theme, focusedIndex, selectedHand, scaleByWeight, lensPosition, hoveredIndex, patterns });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [canvasRef, model, mode, sizePx, pixelRatio, theme, focusedIndex, selectedHand, scaleByWeight, lensPosition, hoveredIndex]);
}
