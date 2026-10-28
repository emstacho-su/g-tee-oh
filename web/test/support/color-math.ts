/**
 * Colour math for the range matrix scale tests (S38, R3.12, O-384, O-385). Pure, test-only.
 *
 * Mechanism: hex colours go to linear sRGB, from there to OKLab (Bjorn Ottosson's matrices) for
 * perceptual lightness and distance, and to WCAG 2 relative luminance for contrast ratios.
 * Colour vision deficiency is simulated with the Machado, Oliveira and Fernandes (2009) matrices
 * at severity 1 (full protanopia, deuteranopia and tritanopia), applied in linear sRGB and
 * clamped to the gamut. An rgba() string is composited over an opaque ground before measuring.
 */

export type Rgb = readonly [number, number, number];
export type Matrix3 = readonly [Rgb, Rgb, Rgb];
export type Deficiency = "protanopia" | "deuteranopia" | "tritanopia";

export interface OkLab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

const HEX = /^#([0-9a-f]{6})$/i;
const RGBA = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i;
const BYTE = 255;

/** Machado 2009, severity 1.0, rows applied to linear sRGB. */
export const CVD_MATRICES: Readonly<Record<Deficiency, Matrix3>> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export const DEFICIENCIES: readonly Deficiency[] = ["protanopia", "deuteranopia", "tritanopia"];

/** 0..255 sRGB channels of a #rrggbb colour. */
export function hexToRgb(hex: string): Rgb {
  const match = HEX.exec(hex);
  if (match === null || match[1] === undefined) throw new RangeError(`not a #rrggbb colour: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & BYTE, (value >> 8) & BYTE, value & BYTE];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const byte = (channel: number) => Math.round(Math.min(BYTE, Math.max(0, channel))).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

function toLinear(channel: number): number {
  const c = channel / BYTE;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number): number {
  const c = Math.min(1, Math.max(0, value));
  return BYTE * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
}

export function linearRgb(hex: string): Rgb {
  const [r, g, b] = hexToRgb(hex);
  return [toLinear(r), toLinear(g), toLinear(b)];
}

/** An opaque #rrggbb for a #rrggbb or rgba() colour laid over an opaque ground. */
export function composite(colour: string, ground: string): string {
  const match = RGBA.exec(colour);
  if (match === null) return colour;
  const [, r, g, b, alpha] = match.map(Number) as [number, number, number, number, number];
  const [gr, gg, gb] = hexToRgb(ground);
  return rgbToHex([r * alpha + gr * (1 - alpha), g * alpha + gg * (1 - alpha), b * alpha + gb * (1 - alpha)]);
}

/** WCAG 2 relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = linearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function linearToOkLab([r, g, b]: Rgb): OkLab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function okLab(hex: string): OkLab {
  return linearToOkLab(linearRgb(hex));
}

/** Euclidean distance in OKLab (about 0.02 is a just noticeable difference). */
export function okDistance(first: string, second: string): number {
  const x = okLab(first);
  const y = okLab(second);
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
}

/** A colour as seen with a full colour vision deficiency, as #rrggbb. */
export function simulate(hex: string, deficiency: Deficiency): string {
  const [r, g, b] = linearRgb(hex);
  const [row0, row1, row2] = CVD_MATRICES[deficiency];
  const apply = (row: Rgb) => fromLinear(row[0] * r + row[1] * g + row[2] * b);
  return rgbToHex([apply(row0), apply(row1), apply(row2)]);
}

/** A #rrggbb from OKLCH, with chroma lowered until it fits the sRGB gamut. */
export function okLchToHex(lightness: number, chroma: number, hueDegrees: number): string {
  const hue = (hueDegrees * Math.PI) / 180;
  for (let c = chroma; c >= 0; c -= 0.002) {
    const a = c * Math.cos(hue);
    const b = c * Math.sin(hue);
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const rgb: Rgb = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    if (rgb.every((channel) => channel >= -1e-6 && channel <= 1 + 1e-6)) return rgbToHex(rgb.map(fromLinear) as unknown as Rgb);
  }
  return rgbToHex([fromLinear(lightness ** 3), fromLinear(lightness ** 3), fromLinear(lightness ** 3)]);
}

/** OKLCH hue in degrees of a colour. */
export function okHue(hex: string): number {
  const { a, b } = okLab(hex);
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}
