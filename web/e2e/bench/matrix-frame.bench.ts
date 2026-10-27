/**
 * The matrix frame bench (S24, R3.12, O-260): measures the range matrix frame in headless
 * Chromium and writes validation/reports/matrix-frame-<machine>.json.
 *
 * Mechanism: the bench project (playwright.config.ts) serves the harness build on
 * http://localhost:4173. This spec opens /bench.html, calls window.__runMatrixBench (src/bench)
 * with BENCH_FRAMES recorded frames per mode (600 by default), builds the report with
 * report.ts and writes it to BENCH_REPORT_DIR (default validation/reports at the repo root) as
 * matrix-frame-<BENCH_MACHINE or zenbook>.json. BENCH_CONCURRENT_WORK records any heavy work
 * running at the same time ("none recorded" when unset). The file is written before the budget
 * is asserted, so a frame over budget still leaves its evidence, and then the test fails when a
 * mode's p95 is 16 ms or more. The real measurement runs under the bench lock (`just
 * bench-web`); hosted continuous integration never runs it and only checks the committed file.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, platform, release, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import {
  FRAME_BUDGET_MS,
  REPORT_ID,
  buildMatrixFrameReport,
  parseFrameCount,
  parseMachineName,
  type MachineInfo,
} from "./report.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_REPORT_DIR = join(REPO_ROOT, "validation", "reports");
const BYTES_PER_GIB = 1024 ** 3;
const NO_CONCURRENT_WORK = "none recorded";

function machineInfo(name: string): MachineInfo {
  const cores = cpus();
  return {
    name,
    os: `${platform()} ${release()}`,
    cpu: cores[0]?.model.trim() ?? "unknown",
    cores: cores.length,
    memory_gb: Math.round(totalmem() / BYTES_PER_GIB),
  };
}

function gitHead(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function playwrightVersion(): string {
  const require = createRequire(import.meta.url);
  const manifest = require("@playwright/test/package.json") as { version?: unknown };
  return typeof manifest.version === "string" ? manifest.version : "unknown";
}

function concurrentWork(): string {
  const value = process.env.BENCH_CONCURRENT_WORK?.trim();
  return value === undefined || value === "" ? NO_CONCURRENT_WORK : value;
}

test("R3.12 matrix frame p95 stays under 16 ms per mode at device pixel ratio 2", async ({ page, browser }) => {
  const machine = parseMachineName(process.env.BENCH_MACHINE);
  const frames = parseFrameCount(process.env.BENCH_FRAMES);
  const reportDir = resolve(process.env.BENCH_REPORT_DIR?.trim() || DEFAULT_REPORT_DIR);

  await page.goto("/bench.html");
  await page.waitForFunction(() => typeof window.__runMatrixBench === "function");
  const result = await page.evaluate(async (count) => {
    const run = window.__runMatrixBench;
    if (run === undefined) throw new Error("bench page has no __runMatrixBench");
    return run({ frames: count });
  }, frames);

  const report = buildMatrixFrameReport({
    result,
    machine: machineInfo(machine),
    commit: gitHead(),
    date: new Date().toISOString(),
    browserVersion: browser.version(),
    playwrightVersion: playwrightVersion(),
    concurrentWork: concurrentWork(),
  });
  mkdirSync(reportDir, { recursive: true });
  const file = join(reportDir, `${REPORT_ID}-${machine}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  test.info().annotations.push({ type: "report", description: file });
  test.info().annotations.push({ type: "renderer", description: `${result.renderer.string ?? "unavailable"} (${result.renderer.kind})` });

  for (const mode of result.modes) {
    expect(mode.n, `${mode.mode} recorded frames`).toBe(frames);
    expect(mode.p95, `${mode.mode} p95 in ms`).toBeLessThan(FRAME_BUDGET_MS);
  }
});
