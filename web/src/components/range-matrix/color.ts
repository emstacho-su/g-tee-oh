/**
 * Small colour helpers for the range matrix (S38, R3.12, A7 section 4). Pure.
 *
 * Mechanism: WCAG 2 relative luminance of a #rrggbb colour decides which ink reads on a fill.
 * inkFor picks whichever of two inks has the higher contrast ratio on the fill (the matrix's
 * printed numbers); isDarkFill says whether a fill is dark enough that hatch lines must be light
 * to stay visible. The action colours come from src/theme/action-style.ts and may be retuned, so
 * the choice is computed from the colour, never hard-coded per action. A colour that is not
 * #rrggbb throws a RangeError naming it, so a bad palette entry fails loudly.
 */
const HEX = /^#([0-9a-f]{6})$/i;
const BYTE = 255;
const CHANNEL_KNEE = 0.04045;
/** Below this luminance black and white ink have about equal contrast; darker fills take light ink. */
export const DARK_FILL_LUMINANCE = 0.18;
const FLARE = 0.05;

function channel(byte: number): number {
  const value = byte / BYTE;
  return value <= CHANNEL_KNEE ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance of a #rrggbb colour, 0 to 1. */
export function relativeLuminance(hex: string): number {
  const match = HEX.exec(hex);
  if (match === null || match[1] === undefined) throw new RangeError(`range matrix: not a #rrggbb colour: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  const [r, g, b] = [(value >> 16) & BYTE, (value >> 8) & BYTE, value & BYTE];
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(first: number, second: number): number {
  return (Math.max(first, second) + FLARE) / (Math.min(first, second) + FLARE);
}

/** The ink of the two with the higher contrast ratio on the fill. */
export function inkFor(fill: string, darkInk: string, lightInk: string): string {
  const ground = relativeLuminance(fill);
  return contrast(ground, relativeLuminance(darkInk)) >= contrast(ground, relativeLuminance(lightInk)) ? darkInk : lightInk;
}

/** True when hatch lines over this fill should be light. */
export function isDarkFill(fill: string): boolean {
  return relativeLuminance(fill) < DARK_FILL_LUMINANCE;
}
