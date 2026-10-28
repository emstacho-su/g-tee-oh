/**
 * Tests for the solver surface colours (S38, R3.13, O-346, O-389, A7 section 4): every action
 * colour and every bet or raise size shade at 3:1 or more against the surface and surface-raised
 * grounds of its theme (WCAG 1.4.11, non-text contrast), the all-in colour apart from every raise
 * shade, the size shades gaining contrast with size, the hatch ink following the fill, and every
 * felt (the standard one and each cosmetic) at 3:1 against the grounds with the table's white text
 * at 4.5:1 on it. The grounds and felts are read from styles.css, so a token change is checked here.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { contrastRatio, relativeLuminance } from "../../src/theme/color-contrast.js";
import {
  ACTION_STYLES,
  HATCH_INK,
  SIZE_SHADES,
  hatchInkFor,
  type ThemeName,
} from "../../src/theme/action-style.js";

const STYLES = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "styles.css"), "utf8");
const THEMES: readonly ThemeName[] = ["light", "dark"];
const NON_TEXT_MINIMUM = 3;
const TEXT_MINIMUM = 4.5;
const WHITE = "#ffffff";

/** The declarations of the first block whose selector list is exactly `selector`. */
function blockOf(selector: string): string {
  const start = STYLES.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`styles.css has no block ${selector}`);
  const open = STYLES.indexOf("{", start);
  return STYLES.slice(open + 1, STYLES.indexOf("}", open));
}

function tokenIn(block: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  if (match?.[1] === undefined) throw new Error(`no hex value for --${name}`);
  return match[1].toLowerCase();
}

const GROUND_BLOCKS: Readonly<Record<ThemeName, string>> = { light: ":root", dark: ".dark" };

function grounds(theme: ThemeName): readonly string[] {
  const block = blockOf(GROUND_BLOCKS[theme]);
  return [tokenIn(block, "surface"), tokenIn(block, "surface-raised")];
}

const COSMETIC_FELTS = ["none", "felt-tier-III", "felt-tier-V", "felt-tier-VII"] as const;

function feltsOf(theme: ThemeName): readonly (readonly [string, string])[] {
  const base: readonly [string, string] = [`${theme} standard`, tokenIn(blockOf(GROUND_BLOCKS[theme]), "felt")];
  const cosmetics = COSMETIC_FELTS.map((felt) => {
    const selector = theme === "light" ? `[data-felt="${felt}"]` : `.dark[data-felt="${felt}"],\n.dark [data-felt="${felt}"]`;
    return [`${theme} ${felt}`, tokenIn(blockOf(selector), "felt")] as const;
  });
  return [base, ...cosmetics];
}

function everyActionColour(theme: ThemeName): readonly (readonly [string, string])[] {
  const kinds = Object.values(ACTION_STYLES).map((style) => [style.name, style.color[theme]] as const);
  const shades = SIZE_SHADES[theme].map((shade, rank) => [`size shade ${rank}`, shade] as const);
  return [...kinds, ...shades];
}

describe("R3.13 action colours on the S36 grounds (O-346)", () => {
  for (const theme of THEMES) {
    it(`R3.13 every action colour and size shade is at least 3:1 on surface and surface-raised in ${theme}`, () => {
      const failures = everyActionColour(theme).flatMap(([name, colour]) =>
        grounds(theme)
          .map((ground) => ({ name, colour, ground, ratio: contrastRatio(colour, ground) }))
          .filter((pair) => pair.ratio < NON_TEXT_MINIMUM),
      );
      expect(failures).toEqual([]);
    });

    it(`R3.13 the all-in colour differs from every bet and raise shade in ${theme}`, () => {
      const allIn = ACTION_STYLES.all_in.color[theme];
      expect(SIZE_SHADES[theme]).not.toContain(allIn);
      expect(allIn).not.toBe(ACTION_STYLES.raise.color[theme]);
    });

    it(`R3.13 a larger size shade stands out more from the ground in ${theme}`, () => {
      const [surface] = grounds(theme);
      const ratios = SIZE_SHADES[theme].map((shade) => contrastRatio(shade, surface ?? WHITE));
      const ascending = ratios.every((ratio, rank) => rank === 0 || ratio > (ratios[rank - 1] ?? 0));
      expect(ascending).toBe(true);
      expect(new Set(SIZE_SHADES[theme]).size).toBe(SIZE_SHADES[theme].length);
    });
  }

  it("R3.13 the hatch ink is light on dark fills and dark on light fills, so patterns stay visible", () => {
    expect(hatchInkFor("#7f1d1d")).toBe(HATCH_INK.onDark);
    expect(hatchInkFor("#fecaca")).toBe(HATCH_INK.onLight);
    for (const theme of THEMES) {
      for (const [, colour] of everyActionColour(theme)) {
        const expected = relativeLuminance(colour) < HATCH_INK.lightnessSplit ? HATCH_INK.onDark : HATCH_INK.onLight;
        expect(hatchInkFor(colour)).toBe(expected);
      }
    }
  });
});

describe("R3.13 felts on the S36 grounds (O-346)", () => {
  for (const theme of THEMES) {
    it(`R3.13 every ${theme} felt is at least 3:1 on the grounds and keeps white text at 4.5:1`, () => {
      const failures = feltsOf(theme).flatMap(([name, felt]) => [
        ...grounds(theme)
          .map((ground) => ({ name, check: `against ${ground}`, ratio: contrastRatio(felt, ground) }))
          .filter((pair) => pair.ratio < NON_TEXT_MINIMUM),
        ...[{ name, check: "white text", ratio: contrastRatio(WHITE, felt) }].filter((pair) => pair.ratio < TEXT_MINIMUM),
      ]);
      expect(failures).toEqual([]);
    });
  }
});

describe("R3.13 colour contrast helpers", () => {
  it("R3.13 computes WCAG relative luminance and ratios", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
    expect(relativeLuminance("#000000")).toBeCloseTo(0);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21);
  });

  it("R3.13 rejects a value that is not a hex colour", () => {
    expect(() => relativeLuminance("red")).toThrow(RangeError);
  });
});
