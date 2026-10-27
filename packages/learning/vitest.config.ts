/**
 * Vitest configuration of @g-tee-oh/learning (S22). Tests run with the defaults; the coverage
 * script (just coverage-learning) measures src with the V8 provider and fails under the 80 percent
 * gate the handoffs set for new code (A9 section 1). Type-only and re-export files are measured too,
 * so the gate covers every module the package ships.
 */
import { defineConfig } from "vitest/config";

const COVERAGE_GATE_PERCENT = 80;

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        lines: COVERAGE_GATE_PERCENT,
        branches: COVERAGE_GATE_PERCENT,
        functions: COVERAGE_GATE_PERCENT,
        statements: COVERAGE_GATE_PERCENT,
      },
    },
  },
});
