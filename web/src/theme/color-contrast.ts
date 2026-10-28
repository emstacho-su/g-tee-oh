/**
 * WCAG 2 relative luminance and contrast ratio of hex colours (S38, R3.13, O-346). Pure.
 *
 * Mechanism: each sRGB channel is linearised (the WCAG 2 formula, threshold 0.03928) and weighted
 * 0.2126, 0.7152 and 0.0722; the ratio is (lighter + 0.05) / (darker + 0.05), from 1 to 21. The
 * same formula as scripts/check-contrast.mjs, so the web's own choices (the hatch ink on an action
 * fill) and the contrast gate agree. A value that is not a #rgb or #rrggbb colour throws a
 * RangeError instead of returning a number that means nothing.
 */
const HEX_COLOUR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const CHANNEL_MAX = 255;
const LINEAR_THRESHOLD = 0.03928;
const LINEAR_DIVISOR = 12.92;
const GAMMA_OFFSET = 0.055;
const GAMMA_SCALE = 1.055;
const GAMMA = 2.4;
const RED_WEIGHT = 0.2126;
const GREEN_WEIGHT = 0.7152;
const BLUE_WEIGHT = 0.0722;
const FLARE = 0.05;

function expanded(hex: string): string {
  if (!HEX_COLOUR.test(hex)) throw new RangeError(`not a hex colour: ${hex}`);
  const digits = hex.slice(1);
  return digits.length === 3 ? [...digits].map((digit) => `${digit}${digit}`).join("") : digits;
}

function linear(byte: number): number {
  const channel = byte / CHANNEL_MAX;
  return channel <= LINEAR_THRESHOLD ? channel / LINEAR_DIVISOR : ((channel + GAMMA_OFFSET) / GAMMA_SCALE) ** GAMMA;
}

/** The WCAG relative luminance of a hex colour, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const digits = expanded(hex);
  const [red, green, blue] = [0, 2, 4].map((start) => linear(Number.parseInt(digits.slice(start, start + 2), 16)));
  return RED_WEIGHT * (red ?? 0) + GREEN_WEIGHT * (green ?? 0) + BLUE_WEIGHT * (blue ?? 0);
}

/** The WCAG contrast ratio of two hex colours, 1 to 21, in either order. */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((left, right) => right - left);
  return ((lighter ?? 0) + FLARE) / ((darker ?? 0) + FLARE);
}

/** The ink of the two with the higher contrast ratio on the fill (the matrix's printed numbers). */
export function inkFor(fill: string, darkInk: string, lightInk: string): string {
  return contrastRatio(darkInk, fill) >= contrastRatio(lightInk, fill) ? darkInk : lightInk;
}

/**
 * The one lightness split for patterns drawn over a fill (review round 1, 5): a fill with a relative
 * luminance below it is dark and takes light hatch lines, on the action swatches (hatchInkFor) and
 * on the range matrix's canvas alike.
 */
export const DARK_FILL_LUMINANCE = 0.2;

/** True when lines drawn over this fill should be light. */
export function isDarkFill(fill: string): boolean {
  return relativeLuminance(fill) < DARK_FILL_LUMINANCE;
}
