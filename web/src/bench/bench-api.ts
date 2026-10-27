/**
 * The shapes the matrix frame bench page hands to the Playwright spec (S24, R3.12, O-260).
 *
 * Mechanism: bench.html (harness build only, O-267) puts window.__runMatrixBench on the page;
 * e2e/bench/matrix-frame.bench.ts calls it through page.evaluate and gets a MatrixBenchResult
 * back as plain JSON. Keeping the types here lets the page and the spec agree at compile time.
 */
import type { MatrixMode } from "../components/range-matrix/model.js";

export type RendererKind = "gpu" | "software" | "unknown";

export interface RendererInfo {
  /** UNMASKED_RENDERER_WEBGL when the debug extension is there, else the plain RENDERER, else null. */
  readonly string: string | null;
  readonly kind: RendererKind;
}

export interface ModeFrames {
  readonly mode: MatrixMode;
  readonly n: number;
  /** Every recorded frame time in milliseconds, sorted ascending. */
  readonly framesMs: readonly number[];
  readonly p50: number;
  /** Nearest rank: the value at rank ceil(0.95 n) of the sorted times. */
  readonly p95: number;
  readonly max: number;
}

export interface MatrixBenchOptions {
  /** Recorded frames per mode; 600 by default. */
  readonly frames?: number;
  /** Untimed frames per mode before recording; 30 by default. */
  readonly warmupFrames?: number;
  /** Wait for an animation frame between frames (the default); false runs back to back. */
  readonly paced?: boolean;
}

export interface MatrixBenchResult {
  readonly modes: readonly ModeFrames[];
  readonly renderer: RendererInfo;
  readonly userAgent: string;
  readonly pixelRatio: number;
  readonly sizePx: number;
  readonly frames: number;
  readonly warmupFrames: number;
  readonly variants: number;
}

declare global {
  interface Window {
    __runMatrixBench?: (options?: MatrixBenchOptions) => Promise<MatrixBenchResult>;
  }
}
