/**
 * One visual identity per action kind, shared by RangeMatrix, ActionFrequencyTable, ActionBar
 * and the feedback panel (S24, S38, A7 section 4, O-346, O-389).
 *
 * Mechanism: every action kind gets a color per theme, a hatch pattern and a short text label.
 * A7 section 4 says color is never the only signal, so every place that paints an action also
 * draws its pattern (canvas and SVG) or prints its label, which keeps the views readable for
 * color-blind users and in grayscale screenshots. Raises and bets get a shade per size rank at a
 * node, so two raise sizes still differ by shade and by their printed size. The canvas cannot
 * resolve CSS variables, which is why the colors live here as hex values beside the semantic
 * tokens in styles.css.
 *
 * Tuning (S38, O-346): every color and size shade is at 3:1 or more against the S36 grounds of its
 * theme (surface and surface-raised, WCAG 1.4.11), which `just contrast` gates (O-389). The hues
 * keep the trainer convention, fold blue, check and call green, raise red, so they read the same
 * as before; only lightness moved. Sources, light theme (cream grounds, so each is a deep shade):
 * fold Tailwind blue-600, check and call green-700, limp lime-700, straddle violet-700, bet and
 * raise red-600 (also the first size shade), all-in fuchsia-800, its own hue so it never reads as
 * one more raise size. Dark theme (deep brown grounds, so each is a lifted shade): fold blue-500,
 * check and call green-500, limp lime-500, straddle violet-400, bet and raise red-500, all-in
 * fuchsia-400.
 *
 * Size shades: a larger size stands out more from the ground, so in light they deepen (red-600,
 * red-700, red-800, red-900) and in dark they lift (red-500, red-400, red-300, red-200); the first
 * shade is the kind's own color. The contrast gate reads ACTION_STYLES and SIZE_SHADES by their
 * shape, so their entries stay on one line each and carry no comments.
 */
import type { ActionKind, NodeAction } from "../contracts.js";
import { DARK_FILL_LUMINANCE, inkFor, isDarkFill } from "./color-contrast.js";

export type ThemeName = "light" | "dark";
export type HatchPattern = "none" | "diagonal" | "cross" | "dots" | "vertical" | "horizontal" | "reverse";

export interface ActionStyle {
  readonly kind: ActionKind;
  /** Short label printed on bars and legends, never relying on color alone. */
  readonly short: string;
  /** Human name for legends and accessible labels. */
  readonly name: string;
  readonly pattern: HatchPattern;
  readonly color: Readonly<Record<ThemeName, string>>;
}

export const ACTION_STYLES: Readonly<Record<ActionKind, ActionStyle>> = {
  fold: { kind: "fold", short: "F", name: "Fold", pattern: "none", color: { light: "#2563eb", dark: "#3b82f6" } },
  check: { kind: "check", short: "X", name: "Check", pattern: "dots", color: { light: "#15803d", dark: "#22c55e" } },
  call: { kind: "call", short: "C", name: "Call", pattern: "dots", color: { light: "#15803d", dark: "#22c55e" } },
  limp: { kind: "limp", short: "L", name: "Limp", pattern: "vertical", color: { light: "#4d7c0f", dark: "#84cc16" } },
  straddle: {
    kind: "straddle",
    short: "S",
    name: "Straddle",
    pattern: "horizontal",
    color: { light: "#6d28d9", dark: "#a78bfa" },
  },
  bet: { kind: "bet", short: "B", name: "Bet", pattern: "diagonal", color: { light: "#dc2626", dark: "#ef4444" } },
  raise: { kind: "raise", short: "R", name: "Raise", pattern: "diagonal", color: { light: "#dc2626", dark: "#ef4444" } },
  all_in: { kind: "all_in", short: "A", name: "All-in", pattern: "cross", color: { light: "#86198f", dark: "#e879f9" } },
};

/** Shades for the first, second, third and later sizes of a sized kind at one node. */
export const SIZE_SHADES: Readonly<Record<ThemeName, readonly string[]>> = {
  light: ["#dc2626", "#b91c1c", "#991b1b", "#7f1d1d"],
  dark: ["#ef4444", "#f87171", "#fca5a5", "#fecaca"],
};

/**
 * The hatch ink drawn over an action fill: light ink on a dark fill, dark ink on a light one, so
 * the pattern stays visible on the deeper light-theme colors and on the lifted dark-theme ones.
 * lightnessSplit is the relative luminance below which a fill counts as dark.
 */
export const HATCH_INK = {
  onDark: "rgba(255, 255, 255, 0.5)",
  onLight: "rgba(0, 0, 0, 0.35)",
  lightnessSplit: DARK_FILL_LUMINANCE,
} as const;

/** The hatch ink for one fill color (a hex value). */
export function hatchInkFor(fill: string): string {
  return isDarkFill(fill) ? HATCH_INK.onDark : HATCH_INK.onLight;
}

/**
 * The ink for text printed on an action fill (a roll band's label, a painted cell): white on the
 * deep light-theme fills, the neutral near-black of the dark ground (O-430) on the lifted
 * dark-theme fills, whichever reads better, so every fill keeps its text at 4.5:1 (WCAG 1.4.3).
 */
export const ACTION_INK = {
  onDark: "#ffffff",
  onLight: "#141414",
} as const;

/** The text ink for one fill color (a hex value): the one of the two with the higher contrast. */
export function actionInkFor(fill: string): string {
  return inkFor(fill, ACTION_INK.onDark, ACTION_INK.onLight);
}

const SIZED_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>(["bet", "raise"]);

export function actionStyle(kind: ActionKind): ActionStyle {
  return ACTION_STYLES[kind];
}

/**
 * The size rank of one action at a node: its position among the node's bets and raises sorted by
 * size_cbb ascending (0 for the smallest). A missing size counts as 0, an action whose size the
 * list does not hold ranks 0, and every other kind (fold, check, call, all-in and so on) is 0.
 * actionColor picks the shade by it and the range matrix picks the hatch spacing by it, so one
 * definition keeps the two signals in step.
 */
export function sizeRank(action: NodeAction, actions: readonly NodeAction[]): number {
  if (!SIZED_KINDS.has(action.kind)) return 0;
  const sized = actions
    .filter((candidate) => SIZED_KINDS.has(candidate.kind))
    .map((candidate) => candidate.size_cbb ?? 0)
    .sort((left, right) => left - right);
  return Math.max(0, sized.indexOf(action.size_cbb ?? 0));
}

/**
 * The fill color of one action at a node. Bets and raises take a shade by their sizeRank among
 * the node's sized actions, so two raise sizes never share a color; past the last shade the
 * last one repeats.
 */
export function actionColor(action: NodeAction, actions: readonly NodeAction[], theme: ThemeName): string {
  if (!SIZED_KINDS.has(action.kind)) return ACTION_STYLES[action.kind].color[theme];
  const rank = sizeRank(action, actions);
  const shades = SIZE_SHADES[theme];
  return shades[Math.min(rank, shades.length - 1)] ?? ACTION_STYLES[action.kind].color[theme];
}
