/**
 * Tests for the range matrix colour scales (S38, R3.12, O-384, O-385, O-346): the expected value
 * (EV) and weight steps, and the palettes validated as colours in both themes.
 *
 * Mechanism: the step functions are checked at their boundaries; the palettes are measured with
 * test/support/color-math.ts. Every printed ink reaches 4.5:1 on its step (WCAG 1.4.3), the end
 * steps reach 3:1 on the matrix ground (1.4.11), OKLab lightness runs monotonically away from the
 * neutral middle on each side (so order reads in grayscale), adjacent steps stay apart, and under
 * simulated protanopia, deuteranopia and tritanopia the first steps either side of neutral and the
 * two end steps stay distinct while each side keeps its lightness order. The weight steps are the
 * progress heat map's ramp (O-362), read back from styles.css so the two never drift.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MATRIX_PALETTES, evFill, evInk, weightFill, weightInk } from "../../src/components/range-matrix/matrix-theme.js";
import {
  EV_NEUTRAL_BB,
  EV_STEPS,
  WEIGHT_STEPS,
  evLegend,
  evStep,
  weightLegend,
  weightStep,
} from "../../src/components/range-matrix/scales.js";
import type { ThemeName } from "../../src/theme/action-style.js";
import { DEFICIENCIES, contrastRatio, okDistance, okLab, simulate } from "../support/color-math.js";

const THEMES: readonly ThemeName[] = ["light", "dark"];
const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3;
/** Neighbouring steps at least this far apart in OKLab (about three just noticeable differences). */
const ADJACENT_MIN = 0.06;
/** The two first steps around neutral, and the two end steps, at least this far apart under simulation. */
const FIRST_STEPS_MIN = 0.04;
const END_STEPS_MIN = 0.1;

const STYLES_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "styles.css");

/** The --heat-1 to --heat-5 values of one theme block of styles.css. */
function heatRamp(theme: ThemeName): string[] {
  const css = readFileSync(STYLES_PATH, "utf8");
  const selector = theme === "light" ? ":root {" : ".dark {";
  const start = css.indexOf(selector);
  const body = css.slice(start, css.indexOf("}", start));
  return [1, 2, 3, 4, 5].map((step) => {
    const match = new RegExp(`--heat-${step}:\\s*(#[0-9a-f]{6})`, "i").exec(body);
    if (match?.[1] === undefined) throw new Error(`styles.css ${theme} has no --heat-${step}`);
    return match[1].toLowerCase();
  });
}

/** One side of the EV scale, neutral first, then steps 1 to 5. */
function side(theme: ThemeName, sign: 1 | -1): string[] {
  const palette = MATRIX_PALETTES[theme];
  return [palette.evNeutral, ...(sign > 0 ? palette.evPositive : palette.evNegative)];
}

function lightnessOf(colours: readonly string[]): number[] {
  return colours.map((colour) => okLab(colour).l);
}

function isMonotonic(values: readonly number[]): boolean {
  const rising = values.every((value, index) => index === 0 || value > (values[index - 1] ?? Number.NaN));
  const falling = values.every((value, index) => index === 0 || value < (values[index - 1] ?? Number.NaN));
  return rising || falling;
}

describe("R3.12 range matrix EV and weight steps", () => {
  it("R3.12 an EV within the neutral band is step 0, and steps run 1 to 5 by share of the scale end", () => {
    expect(evStep(0, 2)).toBe(0);
    expect(evStep(EV_NEUTRAL_BB - 0.001, 2)).toBe(0);
    expect(evStep(-(EV_NEUTRAL_BB - 0.001), 2)).toBe(0);
    expect(evStep(EV_NEUTRAL_BB, 2)).toBe(1);
    expect(evStep(0.4, 2)).toBe(1);
    expect(evStep(0.41, 2)).toBe(2);
    expect(evStep(-1.99, 2)).toBe(-5);
    expect(evStep(-50, 2)).toBe(-EV_STEPS);
    expect(evStep(50, 2)).toBe(EV_STEPS);
  });

  it("R3.12 weight 0 is step 0, unknown is null, and quintiles are steps 1 to 5", () => {
    expect(weightStep(null)).toBeNull();
    expect(weightStep(0)).toBe(0);
    expect(weightStep(0.001)).toBe(1);
    expect(weightStep(0.2)).toBe(1);
    expect(weightStep(0.21)).toBe(2);
    expect(weightStep(1)).toBe(WEIGHT_STEPS);
    expect(weightStep(1.5)).toBe(WEIGHT_STEPS);
  });

  it("R3.12 the EV legend has eleven steps from -5 to 5 with bb boundaries and a named neutral", () => {
    const legend = evLegend(2);
    expect(legend.map((entry) => entry.step)).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
    expect(legend[5]?.short).toBe("near 0");
    expect(legend[5]?.long).toBe("near 0: within 0.05bb either way");
    expect(legend[6]?.short).toBe("+0.4");
    expect(legend[6]?.long).toBe("+0.05bb to +0.4bb");
    expect(legend[10]?.long).toBe("more than +1.6bb");
    expect(legend[0]?.short).toBe("-2.0");
    expect(legend[0]?.long).toBe("less than -1.6bb");
  });

  it("R3.12 the weight legend runs from the empty ground to 100 percent", () => {
    const legend = weightLegend();
    expect(legend.map((entry) => entry.step)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(legend[0]?.long).toBe("0%: not in the range");
    expect(legend[1]?.long).toBe("1% to 20%");
    expect(legend[5]?.long).toBe("81% to 100%");
  });
});

describe("R3.12 range matrix palettes as colours", () => {
  for (const theme of THEMES) {
    const palette = MATRIX_PALETTES[theme];

    it(`R3.12 ${theme}: the weight steps equal the progress heat ramp in styles.css (O-362)`, () => {
      expect(palette.weightSteps.map((colour) => colour.toLowerCase())).toEqual(heatRamp(theme));
    });

    it(`R3.12 ${theme}: every printed ink reaches 4.5:1 on its EV and weight step`, () => {
      for (const ev of [0, 0.1, 0.5, 0.9, 1.3, 1.7, -0.1, -0.5, -0.9, -1.3, -1.7, 3, -3]) {
        expect(contrastRatio(evInk(palette, ev, 2), evFill(palette, ev, 2))).toBeGreaterThanOrEqual(TEXT_MIN);
      }
      for (const weight of [0, 0.1, 0.3, 0.5, 0.7, 0.9]) {
        expect(contrastRatio(weightInk(palette, weight), weightFill(palette, weight) ?? palette.background)).toBeGreaterThanOrEqual(
          TEXT_MIN,
        );
      }
      expect(contrastRatio(palette.labelText, palette.missingFill)).toBeGreaterThanOrEqual(TEXT_MIN);
      expect(contrastRatio(palette.text, palette.background)).toBeGreaterThanOrEqual(TEXT_MIN);
    });

    it(`R3.12 ${theme}: the EV end steps and the strongest weight step reach 3:1 on the matrix ground`, () => {
      for (const end of [palette.evNegative.at(-1), palette.evPositive.at(-1), palette.weightSteps.at(-1)]) {
        expect(contrastRatio(end ?? "", palette.background)).toBeGreaterThanOrEqual(NON_TEXT_MIN);
      }
    });

    it(`R3.12 ${theme}: lightness runs monotonically from the neutral middle and steps stay apart`, () => {
      for (const sign of [1, -1] as const) {
        const colours = side(theme, sign);
        expect(isMonotonic(lightnessOf(colours))).toBe(true);
        colours.slice(1).forEach((colour, index) => {
          expect(okDistance(colour, colours[index] ?? "")).toBeGreaterThanOrEqual(ADJACENT_MIN);
        });
      }
      expect(isMonotonic(lightnessOf(palette.weightSteps))).toBe(true);
    });

    for (const deficiency of DEFICIENCIES) {
      it(`R3.12 ${theme}: under ${deficiency} the first and end steps stay distinct and each side keeps its order`, () => {
        const seen = (colour: string) => simulate(colour, deficiency);
        const [firstNegative, firstPositive] = [palette.evNegative[0] ?? "", palette.evPositive[0] ?? ""];
        expect(okDistance(seen(firstNegative), seen(firstPositive))).toBeGreaterThanOrEqual(FIRST_STEPS_MIN);
        expect(okDistance(seen(firstNegative), seen(palette.evNeutral))).toBeGreaterThanOrEqual(FIRST_STEPS_MIN);
        expect(okDistance(seen(firstPositive), seen(palette.evNeutral))).toBeGreaterThanOrEqual(FIRST_STEPS_MIN);
        expect(okDistance(seen(palette.evNegative.at(-1) ?? ""), seen(palette.evPositive.at(-1) ?? ""))).toBeGreaterThanOrEqual(
          END_STEPS_MIN,
        );
        for (const sign of [1, -1] as const) {
          expect(isMonotonic(lightnessOf(side(theme, sign).map(seen)))).toBe(true);
        }
      });
    }
  }
});
