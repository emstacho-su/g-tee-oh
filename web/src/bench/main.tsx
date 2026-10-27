/**
 * Matrix frame bench page (S24, R3.12, O-260, O-267): the bench.html entry, built only with
 * `vite build --mode harness` into dist-harness and served by `pnpm run preview:harness`, never
 * in the production build or image.
 *
 * Mechanism: the page holds one canvas with a forced 2x backing store (1040 by 1040 device
 * pixels for the 520 pixel matrix, whatever the real device pixel ratio is) and exposes
 * window.__runMatrixBench(options). The Playwright spec e2e/bench/matrix-frame.bench.ts calls it
 * and writes the report. The call validates its options, runs the loop of run.ts paced by
 * requestAnimationFrame and timed with performance.now(), and returns the per-mode frame times
 * with the renderer string (renderer.ts) and the user agent. The canvas is not created with
 * willReadFrequently, so it stays on the browser's default (accelerated when a GPU is there)
 * path and the one-pixel read really waits for the drawing to finish.
 */
import "../styles.css";

import type { MatrixBenchOptions, MatrixBenchResult } from "./bench-api.js";
import { detectRenderer } from "./renderer.js";
import {
  BENCH_PIXEL_RATIO,
  BENCH_SIZE_PX,
  DEFAULT_BENCH_FRAMES,
  DEFAULT_WARMUP_FRAMES,
  runMatrixBench,
} from "./run.js";
import { benchVariants } from "./variants.js";
import { canvasTile } from "../components/range-matrix/patterns.js";

function countOption(value: number | undefined, fallback: number, name: string, minimum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`matrix bench: ${name} must be an integer of at least ${minimum}, got ${String(value)}`);
  }
  return value;
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function createBenchCanvas(container: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const backing = BENCH_SIZE_PX * BENCH_PIXEL_RATIO;
  canvas.width = backing;
  canvas.height = backing;
  canvas.style.width = `${BENCH_SIZE_PX}px`;
  canvas.style.height = `${BENCH_SIZE_PX}px`;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Range matrix frame bench canvas");
  container.append(canvas);
  return canvas;
}

async function runBench(canvas: HTMLCanvasElement, options: MatrixBenchOptions = {}): Promise<MatrixBenchResult> {
  const frames = countOption(options.frames, DEFAULT_BENCH_FRAMES, "frames", 1);
  const warmupFrames = countOption(options.warmupFrames, DEFAULT_WARMUP_FRAMES, "warmupFrames", 0);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("matrix bench: the browser gave no 2D canvas context");
  const { modes } = await runMatrixBench<HTMLCanvasElement>({
    context,
    makeTile: canvasTile,
    now: () => performance.now(),
    nextFrame: options.paced === false ? () => Promise.resolve() : nextAnimationFrame,
    frames,
    warmupFrames,
  });
  return {
    modes,
    renderer: detectRenderer(document),
    userAgent: navigator.userAgent,
    pixelRatio: BENCH_PIXEL_RATIO,
    sizePx: BENCH_SIZE_PX,
    frames,
    warmupFrames,
    variants: benchVariants().length,
  };
}

const container = document.getElementById("root");
if (container === null) throw new Error("bench: no #root element");
const heading = document.createElement("h1");
heading.textContent = "Matrix frame bench (R3.12)";
container.append(heading);
const canvas = createBenchCanvas(container);
window.__runMatrixBench = (options) => runBench(canvas, options);
