// Types for the parts of scripts/check-contrast.mjs the web tests import (S43 review rounds 1 and
// 2): the web token tests read styles.css through the same parser the contrast gate uses, so an
// alias such as `--focus: var(--text)` resolves the same way in both places, and they read colours
// and measure neutrality with the gate's own scanner and saturation, not hand-written copies.

export interface ThemeToken {
  readonly value: string;
  readonly source: string | null;
}

export type ThemeTokens = ReadonlyMap<string, ThemeToken>;

/** One colour found in a CSS value: how messages name it, its #rrggbb (alpha dropped) and its HSL saturation. */
export interface ScannedColour {
  readonly text: string;
  readonly hex: string;
  readonly saturation: number;
}

export interface ColourScan {
  readonly colours: readonly ScannedColour[];
  readonly unreadable: readonly string[];
  readonly usesVar: boolean;
}

export const STYLES_PATH: string;

/** The most HSL saturation (0 to 1) a neutral dark token may carry. */
export const NEUTRAL_MAX_SATURATION: number;

export class ContrastError extends Error {}

/** The light (:root) and dark (.dark) colour tokens of a stylesheet, var() resolved. */
export function parseThemes(css: string): { readonly light: ThemeTokens; readonly dark: ThemeTokens };

/** The WCAG 2 contrast ratio of two hex colours. */
export function contrastRatio(first: string, second: string): number;

/** HSL saturation, 0 to 1, of a #rgb or #rrggbb colour. */
export function hslSaturation(hex: string): number;

/** Every colour written in a CSS value (hex, rgb(), hsl(), neutral names), and what could not be read. */
export function scanColours(value: string): ColourScan;
