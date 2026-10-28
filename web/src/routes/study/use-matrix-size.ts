/**
 * The study matrix edge in CSS pixels (S25, R3.12, A7 section 4): the S24 default edge on a
 * desktop, shrunk to the window width minus the page gutters on a narrow screen so the canvas
 * never forces a horizontal scroll, and never below a readable minimum. It follows window resizes.
 */
import { useEffect, useState } from "react";

import { DEFAULT_MATRIX_SIZE_PX } from "../../components/range-matrix/RangeMatrix.js";

/** The page's side padding on both sides together. */
export const MATRIX_GUTTER_PX = 32;
export const MIN_MATRIX_SIZE_PX = 260;

export function matrixSizeFor(windowWidth: number, maxPx: number = DEFAULT_MATRIX_SIZE_PX): number {
  return Math.max(MIN_MATRIX_SIZE_PX, Math.min(maxPx, windowWidth - MATRIX_GUTTER_PX));
}

export function useMatrixSize(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return matrixSizeFor(width);
}
