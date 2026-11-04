/**
 * Canvas colours of the range matrix per theme (S24, S38, R3.12, O-266, O-346, O-384, O-385).
 *
 * Mechanism: a canvas cannot read CSS custom properties per pixel, so the matrix keeps its own hex
 * palette, and every value names its source the way the S36 tokens in src/styles.css do: the
 * ground, text, grid and focus come from the S36 tokens; the expected value (EV) scale is built in
 * OKLCH from two hues, brick red (bf4342, the owner's palette, OKLCH hue 24) for a loss and blue
 * (OKLCH hue 255) for a gain, which stay apart under protanopia, deuteranopia and tritanopia,
 * unlike red against green. Lightness runs monotonically away from the neutral middle (light
 * theme: the neutral lightest; dark theme: the neutral darkest), so the order also reads in
 * grayscale. The weight scale copies the progress heat map's five steps (--heat-1 to --heat-5,
 * O-362; a test reads styles.css so the copies never drift). The ink printed on each step is the
 * dark or light ink with the higher contrast, chosen once at module load (inkFor), so a frame only
 * indexes arrays. test/range-matrix/scales.test.ts checks every pairing and the colour-vision
 * simulation in both themes.
 */
import type { ThemeName } from "../../theme/action-style.js";
import { inkFor } from "../../theme/color-contrast.js";
import { EV_STEPS, evStep, lossStep, weightStep } from "./scales.js";

export interface MatrixPalette {
  readonly background: string;
  readonly gridLine: string;
  readonly text: string;
  /** Behind the hand label over frequency bars and missing cells, so it reads over any fill. */
  readonly labelChip: string;
  readonly labelText: string;
  readonly missingFill: string;
  readonly missingInk: string;
  /** Hatch lines over a light action fill. */
  readonly hatchInkDark: string;
  /** Hatch lines over a dark action fill. */
  readonly hatchInkLight: string;
  /** From the weakest to the strongest negative step. */
  readonly evNegative: readonly string[];
  readonly evNeutral: string;
  /** From the weakest to the strongest positive step. */
  readonly evPositive: readonly string[];
  /** Weight steps 1 to 5, the progress heat ramp. */
  readonly weightSteps: readonly string[];
  /** The two inks printed on a filled step. */
  readonly inkDark: string;
  readonly inkLight: string;
  readonly focus: string;
  /** A thin line inside the focus ring, so the ring shows on any fill. */
  readonly focusHalo: string;
  readonly selected: string;
  /** Over a hand the action filters leave out (S45, O-468): the ground, translucent, so the hatch and letters show through. */
  readonly dimOverlay: string;
}

/** A palette with the ink per step resolved once. */
export interface ResolvedPalette extends MatrixPalette {
  readonly evNegativeInk: readonly string[];
  readonly evNeutralInk: string;
  readonly evPositiveInk: readonly string[];
  readonly weightInk: readonly string[];
}

/** --surface-raised (light): the matrix ground and the halo inside its focus and selection marks (--focus-halo). */
const LIGHT_GROUND = "#fbf7f1";
/** --text (light), which --focus aliases (O-433): the text and the focus ring share it. */
const LIGHT_TEXT = "#2b1a16";

const LIGHT: MatrixPalette = {
  background: LIGHT_GROUND, // --surface-raised: e7d7c1 cream, lifted further
  gridLine: LIGHT_GROUND, // the ground again, so cells read as tiles with a cream gutter
  text: LIGHT_TEXT, // --text: 735751 umber, deepened
  labelChip: "rgba(251, 247, 241, 0.85)", // --surface-raised, translucent
  labelText: LIGHT_TEXT, // --text
  missingFill: "#e7d7c1", // --surface-sunken: the e7d7c1 cream palette value
  missingInk: "rgba(115, 87, 81, 0.5)", // --p-umber 735751, translucent
  hatchInkDark: "rgba(43, 26, 22, 0.45)", // --text, translucent
  hatchInkLight: "rgba(251, 247, 241, 0.6)", // --surface-raised, translucent
  evNegative: [
    "#f1cecb", // bf4342 brick hue, OKLCH lightness 0.88
    "#e6a9a4", // bf4342 brick hue, OKLCH lightness 0.79
    "#d8847e", // bf4342 brick hue, OKLCH lightness 0.70
    "#aa4240", // bf4342 brick hue, OKLCH lightness 0.52
    "#940017", // bf4342 brick hue, OKLCH lightness 0.42, chroma at the sRGB edge
  ],
  evNeutral: "#f1eae3", // e7d7c1 cream hue, OKLCH lightness 0.94, nearly grey
  evPositive: [
    "#c6d9f2", // blue, OKLCH hue 255, lightness 0.88
    "#9ebde6", // blue, OKLCH hue 255, lightness 0.79
    "#76a1d9", // blue, OKLCH hue 255, lightness 0.70
    "#336aae", // blue, OKLCH hue 255, lightness 0.52
    "#004b96", // blue, OKLCH hue 255, lightness 0.42
  ],
  weightSteps: ["#d1a195", "#b87f70", "#9d5f4f", "#7d4234", "#5b2a1e"], // --heat-1 to --heat-5, light (O-362)
  inkDark: "#2b1a16", // --heat-ink-low: 735751 umber, deepened
  inkLight: "#fbf7f1", // --heat-ink-high: e7d7c1 cream, lifted
  focus: LIGHT_TEXT, // --focus: var(--text), with the ground halo inside (O-433)
  focusHalo: LIGHT_GROUND, // --focus-halo: var(--surface-raised)
  selected: "#8c1c13", // --selected: var(--accent), the 8c1c13 oxblood palette value (O-434)
  dimOverlay: "rgba(251, 247, 241, 0.65)", // --surface-raised, translucent
};

/** --surface-raised (dark): the matrix ground and the halo inside its focus and selection marks (--focus-halo). */
const DARK_GROUND = "#1e1e1e";
/** --text (dark), which --focus aliases (O-432): the text and the focus ring share it. */
const DARK_TEXT = "#ececec";

const DARK: MatrixPalette = {
  background: DARK_GROUND, // --surface-raised: a neutral gray (O-430)
  gridLine: DARK_GROUND, // the ground again
  text: DARK_TEXT, // --text: a neutral off-white (O-430)
  labelChip: "rgba(30, 30, 30, 0.8)", // --surface-raised, translucent
  labelText: DARK_TEXT, // --text
  missingFill: "#0e0e0e", // --surface-sunken: a neutral near-black (O-430)
  missingInk: "rgba(133, 133, 133, 0.45)", // --border-strong (dark): a neutral gray, translucent
  hatchInkDark: "rgba(20, 20, 20, 0.5)", // --surface: the neutral near-black, translucent
  hatchInkLight: "rgba(236, 236, 236, 0.5)", // --text, translucent
  evNegative: [
    "#593d3a", // bf4342 brick hue, OKLCH lightness 0.39
    "#7c4744", // bf4342 brick hue, OKLCH lightness 0.46
    "#a0514d", // bf4342 brick hue, OKLCH lightness 0.53
    "#f2827c", // bf4342 brick hue, OKLCH lightness 0.73
    "#ffb0a9", // bf4342 brick hue, OKLCH lightness 0.83
  ],
  evNeutral: "#333333", // a neutral gray, OKLCH lightness 0.32, on the neutral dark base (O-430)
  evPositive: [
    "#37465a", // blue, OKLCH hue 255, lightness 0.39
    "#3e5a7d", // blue, OKLCH hue 255, lightness 0.46
    "#446da2", // blue, OKLCH hue 255, lightness 0.53
    "#71aaf3", // blue, OKLCH hue 255, lightness 0.73
    "#a2caff", // blue, OKLCH hue 255, lightness 0.83
  ],
  weightSteps: ["#7e4739", "#9d5f4f", "#c48777", "#e1ac9f", "#f7d5cc"], // --heat-1 to --heat-5, dark (O-362)
  inkDark: "#141414", // --heat-ink-high (dark): the neutral near-black (O-430)
  inkLight: "#fafafa", // --heat-ink-low (dark): a neutral white (O-430)
  focus: DARK_TEXT, // --focus (dark): var(--text), a neutral near-white apart from the red EV and raise fills (O-432)
  focusHalo: DARK_GROUND, // --focus-halo: var(--surface-raised)
  selected: "#ffb3ab", // --selected (dark): bf4342 brick, lifted past the accent (O-434)
  dimOverlay: "rgba(30, 30, 30, 0.65)", // --surface-raised (dark), translucent
};

function resolve(palette: MatrixPalette): ResolvedPalette {
  const ink = (fill: string) => inkFor(fill, palette.inkDark, palette.inkLight);
  return {
    ...palette,
    evNegativeInk: palette.evNegative.map(ink),
    evNeutralInk: ink(palette.evNeutral),
    evPositiveInk: palette.evPositive.map(ink),
    weightInk: palette.weightSteps.map(ink),
  };
}

export const MATRIX_PALETTES: Readonly<Record<ThemeName, ResolvedPalette>> = { light: resolve(LIGHT), dark: resolve(DARK) };

/** The fill of a best EV on the diverging scale whose ends are minus and plus scaleBb. */
export function evFill(palette: MatrixPalette, evBb: number, scaleBb: number): string {
  const step = evStep(evBb, scaleBb);
  if (step === 0) return palette.evNeutral;
  const steps = step > 0 ? palette.evPositive : palette.evNegative;
  return steps[Math.min(EV_STEPS, Math.abs(step)) - 1] ?? palette.evNeutral;
}

/** The ink printed on a best EV's fill. */
export function evInk(palette: ResolvedPalette, evBb: number, scaleBb: number): string {
  const step = evStep(evBb, scaleBb);
  if (step === 0) return palette.evNeutralInk;
  const inks = step > 0 ? palette.evPositiveInk : palette.evNegativeInk;
  return inks[Math.abs(step) - 1] ?? palette.evNeutralInk;
}

/** The fill of a weight: the ground for 0, a heat step for 1 to 5, null when unknown. */
export function weightFill(palette: MatrixPalette, weight: number | null): string | null {
  const step = weightStep(weight);
  if (step === null) return null;
  return step === 0 ? palette.background : (palette.weightSteps[step - 1] ?? palette.background);
}

/** The ink printed on a weight's fill (the text colour on the ground, for 0 or unknown). */
export function weightInk(palette: ResolvedPalette, weight: number | null): string {
  const step = weightStep(weight);
  if (step === null || step === 0) return palette.text;
  return palette.weightInk[step - 1] ?? palette.text;
}

/** The fill of a compare-to-best loss (S45, O-464): the neutral for the best, else the EV palette's negative step. */
export function lossFill(palette: MatrixPalette, lossPctPot: number, scalePctPot: number): string {
  const step = lossStep(lossPctPot, scalePctPot);
  return step === 0 ? palette.evNeutral : (palette.evNegative[step - 1] ?? palette.evNeutral);
}

/** The ink printed on a compare-to-best loss's fill. */
export function lossInk(palette: ResolvedPalette, lossPctPot: number, scalePctPot: number): string {
  const step = lossStep(lossPctPot, scalePctPot);
  return step === 0 ? palette.evNeutralInk : (palette.evNegativeInk[step - 1] ?? palette.evNeutralInk);
}
