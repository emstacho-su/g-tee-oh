// Types for the parts of scripts/check-contrast.mjs the web tests import (S43 review, finding 5):
// the web token tests read styles.css through the same parser the contrast gate uses, so an alias
// such as `--focus: var(--text)` resolves the same way in both places.

export interface ThemeToken {
  readonly value: string;
  readonly source: string | null;
}

export type ThemeTokens = ReadonlyMap<string, ThemeToken>;

export const STYLES_PATH: string;

export class ContrastError extends Error {}

/** The light (:root) and dark (.dark) colour tokens of a stylesheet, var() resolved. */
export function parseThemes(css: string): { readonly light: ThemeTokens; readonly dark: ThemeTokens };

/** The WCAG 2 contrast ratio of two hex colours. */
export function contrastRatio(first: string, second: string): number;
