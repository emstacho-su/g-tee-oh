/**
 * Canvas colors of the range matrix per theme (S24, R3.12, O-266).
 *
 * Mechanism: a canvas cannot read CSS custom properties per pixel, so the matrix keeps its own
 * hex palette beside the semantic tokens of src/styles.css (surface, border, text and focus
 * match those tokens). The expected value (EV) scale is diverging and quantized into a fixed
 * number of steps per side, orange for negative and teal for positive, which stays readable for
 * the common color-vision deficiencies; the EV number is printed in every cell anyway, so color
 * is never the only signal (A7 section 4). Quantizing means a frame picks colors from these
 * arrays and allocates no color strings.
 */
import type { ThemeName } from "../../theme/action-style.js";

export interface MatrixPalette {
  readonly background: string;
  readonly gridLine: string;
  readonly text: string;
  /** Behind the hand label, so it reads over any bar color. */
  readonly labelChip: string;
  readonly labelText: string;
  readonly missingFill: string;
  readonly missingInk: string;
  /** Hatch lines over action bars. */
  readonly hatchInk: string;
  /** From the weakest to the strongest negative step. */
  readonly evNegative: readonly string[];
  readonly evNeutral: string;
  /** From the weakest to the strongest positive step. */
  readonly evPositive: readonly string[];
  readonly weightTrack: string;
  readonly weightFill: string;
  readonly focus: string;
  readonly selected: string;
}

export const MATRIX_PALETTES: Readonly<Record<ThemeName, MatrixPalette>> = {
  light: {
    background: "#ffffff",
    gridLine: "#cbd5e1",
    text: "#0f172a",
    labelChip: "rgba(255, 255, 255, 0.82)",
    labelText: "#0f172a",
    missingFill: "#e5e7eb",
    missingInk: "rgba(71, 85, 105, 0.55)",
    hatchInk: "rgba(15, 23, 42, 0.45)",
    evNegative: ["#fed7aa", "#fdba74", "#fb923c", "#f97316", "#ea580c", "#c2410c"],
    evNeutral: "#f1f5f9",
    evPositive: ["#ccfbf1", "#99f6e4", "#5eead4", "#2dd4bf", "#14b8a6", "#0d9488"],
    weightTrack: "#f1f5f9",
    weightFill: "#818cf8",
    focus: "#f59e0b",
    selected: "#0f172a",
  },
  dark: {
    background: "#111827",
    gridLine: "#334155",
    text: "#e5e7eb",
    labelChip: "rgba(17, 24, 39, 0.78)",
    labelText: "#f8fafc",
    missingFill: "#1f2937",
    missingInk: "rgba(148, 163, 184, 0.5)",
    hatchInk: "rgba(248, 250, 252, 0.4)",
    evNegative: ["#431407", "#7c2d12", "#9a3412", "#c2410c", "#ea580c", "#f97316"],
    evNeutral: "#1f2937",
    evPositive: ["#042f2e", "#134e4a", "#115e59", "#0f766e", "#0d9488", "#14b8a6"],
    weightTrack: "#1f2937",
    weightFill: "#6366f1",
    focus: "#fbbf24",
    selected: "#f8fafc",
  },
};

/** The fill for a best EV on the diverging scale whose ends are minus and plus scaleBb. */
export function evFill(palette: MatrixPalette, evBb: number, scaleBb: number): string {
  if (evBb === 0) return palette.evNeutral;
  const steps = evBb > 0 ? palette.evPositive : palette.evNegative;
  const share = Math.min(1, Math.abs(evBb) / scaleBb);
  const step = Math.max(0, Math.ceil(share * steps.length) - 1);
  return steps[step] ?? palette.evNeutral;
}
