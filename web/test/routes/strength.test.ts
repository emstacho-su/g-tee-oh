/**
 * Password strength (S42, R3.13, O-424): the pure reading, the real estimator, and the bundle
 * rule. @zxcvbn-ts must reach the app only through the dynamic import() in strength.ts, so Vite
 * gives it its own chunk that only /join loads and the main bundle never contains it. The scan
 * reads every source file: a static import or a second entry point would fail here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { loadStrengthEstimator, meetsMinimum, strengthInputs, strengthOf } from "../../src/routes/onboarding/strength.js";

const SRC = join(process.cwd(), "src");
const LOADER = "routes/onboarding/strength.ts";
const ZXCVBN = /@zxcvbn-ts\//;
const DYNAMIC_ZXCVBN = /import\(\s*"@zxcvbn-ts\/(core|language-common)"\s*\)/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("R3.13 password strength", () => {
  it("R3.13 under 12 characters reads Too short whatever the estimate", () => {
    expect(strengthOf("short", 4)).toEqual({ score: 0, label: "Too short" });
    expect(strengthOf("", null)).toEqual({ score: 0, label: "Too short" });
  });

  it("R3.13 without the estimator, length alone reads Fair or Good", () => {
    expect(strengthOf("a".repeat(12), null)).toEqual({ score: 2, label: "Fair" });
    expect(strengthOf("a".repeat(16), null)).toEqual({ score: 3, label: "Good" });
  });

  it("R3.13 with the estimator, a long enough password reads at least Weak", () => {
    expect(strengthOf("a".repeat(12), 0)).toEqual({ score: 1, label: "Weak" });
    expect(strengthOf("a".repeat(12), 4)).toEqual({ score: 4, label: "Strong" });
  });

  it("R3.13 the minimum counts characters, not UTF-16 units", () => {
    expect(meetsMinimum("😀".repeat(11))).toBe(false);
    expect(meetsMinimum("😀".repeat(12))).toBe(true);
  });

  it("R3.13 the real estimator scores a common password low and a long passphrase high, and the user's own words low", async () => {
    const estimate = await loadStrengthEstimator();
    expect(estimate("password1234", [])).toBeLessThanOrEqual(1);
    expect(estimate("plum-orbit-lantern-seventy-9", [])).toBeGreaterThanOrEqual(3);
    const inputs = strengthInputs("Sam.Rivera@example.com", "Sam  Rivera");
    expect(inputs).toEqual(["sam.rivera@example.com", "sam.rivera", "samrivera", "sam", "rivera"]);
    expect(estimate("samrivera2026", inputs)).toBeLessThan(estimate("samrivera2026", []));
    expect(estimate("samrivera2026", inputs)).toBeLessThanOrEqual(1);
    expect(loadStrengthEstimator()).toBe(loadStrengthEstimator());
  });

  it("R3.13 @zxcvbn-ts is reached only by dynamic import in strength.ts, so it stays out of the main bundle", () => {
    const offenders: string[] = [];
    let dynamicImports = 0;
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      if (!ZXCVBN.test(text)) continue;
      const name = relative(SRC, file).replaceAll("\\", "/");
      const dynamic = text.match(DYNAMIC_ZXCVBN) ?? [];
      const withoutDynamic = text.replace(DYNAMIC_ZXCVBN, "");
      if (name !== LOADER || /from\s+"@zxcvbn-ts\//.test(withoutDynamic) || /import\s+"@zxcvbn-ts\//.test(withoutDynamic)) {
        offenders.push(name);
      }
      dynamicImports += dynamic.length;
    }
    expect(offenders).toEqual([]);
    expect(dynamicImports).toBe(2);
  });
});
