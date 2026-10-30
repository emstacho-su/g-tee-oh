/**
 * Tests for the matrix frame bench pieces that run outside a browser (S24, R3.12, O-260): the
 * nearest-rank percentiles, the synthetic node variants, the renderer classification, the bench
 * loop over a recording context, and the report the Playwright spec writes, which must follow
 * validation/reports/report.schema.json and judge every mode's p95 strictly under 16 ms.
 */
import { describe, expect, it } from "vitest";

import { benchVariants } from "../../src/bench/variants.js";
import { classifyRenderer, detectRenderer } from "../../src/bench/renderer.js";
import { runMatrixBench } from "../../src/bench/run.js";
import { nearestRank, summarizeFrames } from "../../src/bench/stats.js";
import { buildMatrixModel } from "../../src/components/range-matrix/model.js";
import { buildMatrixFrameReport, parseFrameCount, parseMachineName } from "../../e2e/bench/report.js";
import type { MatrixBenchResult } from "../../src/bench/bench-api.js";
import { fakePattern, recordingContext } from "./recording-context.js";

const MACHINE = { name: "zenbook", os: "win32 10.0.26200", cpu: "Test CPU", cores: 20, memory_gb: 32 };
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

function result(p95ByMode: Readonly<Record<string, number>>): MatrixBenchResult {
  return {
    modes: (["frequency", "ev", "weight"] as const).map((mode) => ({
      mode,
      n: 3,
      framesMs: [1, 2, p95ByMode[mode] ?? 1],
      p50: 2,
      p95: p95ByMode[mode] ?? 1,
      max: p95ByMode[mode] ?? 1,
    })),
    renderer: { string: "ANGLE (Test GPU)", kind: "gpu" },
    userAgent: "Mozilla/5.0 HeadlessChrome/140.0.0.0",
    pixelRatio: 2,
    sizePx: 520,
    frames: 3,
    warmupFrames: 1,
    variants: 4,
  };
}

function report(p95ByMode: Readonly<Record<string, number>>) {
  return buildMatrixFrameReport({
    result: result(p95ByMode),
    machine: MACHINE,
    commit: COMMIT,
    date: "2026-10-27T12:00:00.000Z",
    browserVersion: "140.0.7339.16",
    playwrightVersion: "1.64.1",
    concurrentWork: "none recorded",
  });
}

describe("R3.12 matrix frame bench statistics", () => {
  it("R3.12 nearestRank takes the value at rank ceil(q n) of the sorted times", () => {
    const sorted = Array.from({ length: 600 }, (_, index) => index + 1);
    expect(nearestRank(sorted, 0.95)).toBe(570);
    expect(nearestRank(sorted, 0.5)).toBe(300);
    expect(nearestRank([7], 0.95)).toBe(7);
    expect(() => nearestRank([], 0.95)).toThrow(RangeError);
  });

  it("R3.12 summarizeFrames sorts a copy and reports n, p50, p95 and max", () => {
    const frames = [5, 1, 4, 2, 3];
    const summary = summarizeFrames("ev", frames);
    expect(frames).toEqual([5, 1, 4, 2, 3]);
    expect(summary).toEqual({ mode: "ev", n: 5, framesMs: [1, 2, 3, 4, 5], p50: 3, p95: 5, max: 5 });
  });
});

describe("R3.12 matrix frame bench data and renderer", () => {
  it("R3.12 the variants are valid, differ from each other and one drops hands", () => {
    const variants = benchVariants();
    expect(variants.length).toBeGreaterThanOrEqual(4);
    const models = variants.map(buildMatrixModel);
    const firstStrategies = models.map((model) => JSON.stringify(model.cells.map((cell) => cell.frequencies)));
    expect(new Set(firstStrategies).size).toBe(variants.length);
    expect(models.some((model) => model.presentCount < 169)).toBe(true);
  });

  it("R3.12 classifies software renderers and everything else as gpu", () => {
    expect(classifyRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe("software");
    expect(classifyRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe("software");
    expect(classifyRenderer("Microsoft Basic Render Driver Software")).toBe("software");
    expect(classifyRenderer("ANGLE (Intel, Intel(R) Arc(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("gpu");
    expect(classifyRenderer(null)).toBe("unknown");
  });

  it("R3.12 detectRenderer prefers the unmasked renderer and reports unknown without WebGL", () => {
    const UNMASKED = 0x9246;
    const RENDERER = 0x1f01;
    function fakeDocument(gl: unknown): Document {
      return { createElement: () => ({ getContext: () => gl }) } as unknown as Document;
    }
    const withDebug = {
      RENDERER,
      getExtension: () => ({ UNMASKED_RENDERER_WEBGL: UNMASKED }),
      getParameter: (name: number) => (name === UNMASKED ? "ANGLE (Test GPU)" : "WebKit WebGL"),
    };
    expect(detectRenderer(fakeDocument(withDebug))).toEqual({ string: "ANGLE (Test GPU)", kind: "gpu" });
    const plain = { ...withDebug, getExtension: () => null, getParameter: () => "SwiftShader" };
    expect(detectRenderer(fakeDocument(plain))).toEqual({ string: "SwiftShader", kind: "software" });
    expect(detectRenderer(fakeDocument(null))).toEqual({ string: null, kind: "unknown" });
  });

  it("R3.12 runMatrixBench times every frame of every mode and flushes with a one-pixel read", async () => {
    const { ctx, ops } = recordingContext();
    let reads = 0;
    const noop = (): void => undefined;
    const context = Object.assign(ctx, {
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      stroke: noop,
      createPattern: () => fakePattern("tile"),
      getImageData: () => {
        reads += 1;
        return { data: new Uint8ClampedArray(4) };
      },
    });
    let clock = 0;
    const outcome = await runMatrixBench({
      context,
      makeTile: () => ({ width: 1, height: 1, getContext: () => context }),
      now: () => (clock += 0.5),
      nextFrame: () => Promise.resolve(),
      frames: 5,
      warmupFrames: 2,
    });
    expect(outcome.modes.map((mode) => mode.mode)).toEqual(["frequency", "ev", "weight", "strategy_ev", "compare"]);
    expect(outcome.modes.every((mode) => mode.n === 5 && mode.framesMs.length === 5)).toBe(true);
    expect(reads).toBe(5 * (5 + 2));
    expect(ops.some((op) => op.op === "fillRect" && op.w === 1040)).toBe(true);
    expect(outcome.modes[0]?.p95).toBeGreaterThan(0);
  });
});

describe("R3.12 matrix frame report", () => {
  it("R3.12 passes when every mode's p95 is under 16 ms and carries the schema envelope", () => {
    const written = report({ frequency: 9, ev: 8, weight: 7 });
    expect(written).toMatchObject({
      report: "matrix-frame",
      r_ids: ["R3.12"],
      machine: MACHINE,
      commit: COMMIT,
      toolchain: "Chromium 140.0.7339.16, Playwright 1.64.1",
      pass: true,
      thresholds: { "frequency/p95": { max: 16, unit: "ms" } },
    });
    const p95 = written.measurements.filter((entry) => entry.id.endsWith("/p95"));
    expect(p95.map((entry) => [entry.id, entry.value, entry.pass])).toEqual([
      ["frequency/p95", 9, true],
      ["ev/p95", 8, true],
      ["weight/p95", 7, true],
    ]);
    expect(written.measurements.some((entry) => entry.id === "ev/max" && entry.pass === undefined)).toBe(true);
    expect(written.notes).toMatch(/ANGLE \(Test GPU\).*gpu/);
    expect(written.notes).toMatch(/none recorded/);
    expect(written.renderer).toEqual({ string: "ANGLE (Test GPU)", kind: "gpu" });
  });

  it("R3.12 fails when one mode's p95 reaches 16 ms, strictly, and names that measurement", () => {
    const written = report({ frequency: 9, ev: 16, weight: 7 });
    expect(written.pass).toBe(false);
    expect(written.measurements.find((entry) => entry.id === "ev/p95")?.pass).toBe(false);
  });

  it("R3.12 parses the machine name and frame count from the environment, rejecting bad values", () => {
    expect(parseMachineName(undefined)).toBe("zenbook");
    expect(parseMachineName("mac-mini")).toBe("mac-mini");
    expect(() => parseMachineName("Bad Name")).toThrow(/BENCH_MACHINE/);
    expect(parseFrameCount(undefined)).toBe(600);
    expect(parseFrameCount("20")).toBe(20);
    expect(() => parseFrameCount("0")).toThrow(/BENCH_FRAMES/);
    expect(() => parseFrameCount("ten")).toThrow(/BENCH_FRAMES/);
  });
});
