/**
 * The matrix frame bench loop (S24, R3.12, O-260, A7 section 4: a matrix frame under 16 ms).
 *
 * Mechanism: for each mode (frequency, expected value, weight) the loop runs warm-up frames
 * that are not recorded, then the recorded frames. A frame takes the next synthetic node of the
 * rotation (variants.ts, so no two neighboring frames draw the same data), builds its model,
 * draws the whole matrix at a forced device pixel ratio of 2 (a 1040 pixel backing store for the
 * 520 pixel matrix), and reads one pixel back with getImageData. The read forces the browser to
 * finish the deferred canvas work, so the time is the real cost of the frame, not just the cost
 * of queuing draw calls. The clock is read before the model build and after the read. Focus and
 * selection move every frame so the outlines are drawn too. Between frames the loop waits for an
 * animation frame (paced), as the component does. The clock, the frame wait and the tile maker
 * are injected so the loop runs under a recording context in the unit tests.
 */
import { drawMatrix, type MatrixCanvasContext } from "../components/range-matrix/draw.js";
import { MATRIX_MODES, buildMatrixModel, type MatrixMode, type MatrixSource } from "../components/range-matrix/model.js";
import { createPatternSource, type PatternSource, type PatternTarget, type TileCanvas } from "../components/range-matrix/patterns.js";
import type { ModeFrames } from "./bench-api.js";
import { summarizeFrames } from "./stats.js";
import { benchVariants } from "./variants.js";

export const BENCH_PIXEL_RATIO = 2;
export const BENCH_SIZE_PX = 520;
export const DEFAULT_BENCH_FRAMES = 600;
export const DEFAULT_WARMUP_FRAMES = 30;

const SELECTION_STRIDE = 7;
const CELL_COUNT = 169;

export interface ImageReadback {
  getImageData(sx: number, sy: number, sw: number, sh: number): unknown;
}

export interface BenchRunInput<T extends TileCanvas> {
  readonly context: MatrixCanvasContext & PatternTarget<T> & ImageReadback;
  readonly makeTile: (sizePx: number) => T;
  readonly now: () => number;
  /** Resolves at the next animation frame; resolve at once to run unpaced. */
  readonly nextFrame: () => Promise<void>;
  readonly frames: number;
  readonly warmupFrames: number;
}

interface FrameInput {
  readonly context: MatrixCanvasContext & ImageReadback;
  readonly node: MatrixSource;
  readonly mode: MatrixMode;
  readonly frame: number;
  readonly patterns: PatternSource;
}

/** One measured frame: model build, full draw and the one-pixel flush. */
function drawFrame({ context, node, mode, frame, patterns }: FrameInput): void {
  const model = buildMatrixModel(node);
  drawMatrix(context, model, {
    mode,
    sizePx: BENCH_SIZE_PX,
    pixelRatio: BENCH_PIXEL_RATIO,
    theme: "light",
    focusedIndex: frame % CELL_COUNT,
    selectedHand: model.cells[(frame * SELECTION_STRIDE) % CELL_COUNT]?.hand ?? null,
    // The heavier bar path (R3.24): strategy with EV measures the weight-scaled bars; compare takes the default lens.
    scaleByWeight: mode === "strategy_ev",
    patterns,
  });
  context.getImageData(0, 0, 1, 1);
}

async function runMode<T extends TileCanvas>(
  input: BenchRunInput<T>,
  mode: MatrixMode,
  variants: readonly MatrixSource[],
  patterns: PatternSource,
): Promise<ModeFrames> {
  const recorded: number[] = [];
  const total = input.warmupFrames + input.frames;
  for (let frame = 0; frame < total; frame += 1) {
    await input.nextFrame();
    const node = variants[frame % variants.length];
    if (node === undefined) throw new RangeError("matrix bench: no synthetic node variants");
    const start = input.now();
    drawFrame({ context: input.context, node, mode, frame, patterns });
    const elapsed = input.now() - start;
    if (frame >= input.warmupFrames) recorded.push(elapsed);
  }
  return summarizeFrames(mode, recorded);
}

export async function runMatrixBench<T extends TileCanvas>(input: BenchRunInput<T>): Promise<{ modes: ModeFrames[] }> {
  const variants = benchVariants();
  const patterns = createPatternSource(input.context, "light", BENCH_PIXEL_RATIO, input.makeTile);
  const modes: ModeFrames[] = [];
  for (const mode of MATRIX_MODES) {
    modes.push(await runMode(input, mode, variants, patterns));
  }
  return { modes };
}
