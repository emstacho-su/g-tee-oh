/**
 * One visual identity per action kind, shared by RangeMatrix, ActionFrequencyTable, ActionBar
 * and the feedback panel (S24, A7 section 4).
 *
 * Mechanism: every action kind gets a color per theme, a hatch pattern and a short text label.
 * A7 section 4 says color is never the only signal, so every place that paints an action also
 * draws its pattern (canvas and SVG) or prints its label, which keeps the views readable for
 * color-blind users and in grayscale screenshots. Raises and bets get a darker shade per size
 * rank at a node, so two raise sizes still differ by shade and by their printed size. The
 * canvas cannot resolve CSS variables, which is why the colors live here as hex values beside
 * the semantic tokens in styles.css.
 */
import type { ActionKind, NodeAction } from "../contracts.js";

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
  fold: { kind: "fold", short: "F", name: "Fold", pattern: "none", color: { light: "#60a5fa", dark: "#3b82f6" } },
  check: { kind: "check", short: "X", name: "Check", pattern: "dots", color: { light: "#4ade80", dark: "#22c55e" } },
  call: { kind: "call", short: "C", name: "Call", pattern: "dots", color: { light: "#4ade80", dark: "#22c55e" } },
  limp: { kind: "limp", short: "L", name: "Limp", pattern: "vertical", color: { light: "#a3e635", dark: "#84cc16" } },
  straddle: {
    kind: "straddle",
    short: "S",
    name: "Straddle",
    pattern: "horizontal",
    color: { light: "#c084fc", dark: "#a855f7" },
  },
  bet: { kind: "bet", short: "B", name: "Bet", pattern: "diagonal", color: { light: "#f87171", dark: "#ef4444" } },
  raise: { kind: "raise", short: "R", name: "Raise", pattern: "diagonal", color: { light: "#f87171", dark: "#ef4444" } },
  all_in: { kind: "all_in", short: "A", name: "All-in", pattern: "cross", color: { light: "#7f1d1d", dark: "#991b1b" } },
};

/** Shades for the second, third and later sizes of a sized kind at one node, light then dark. */
const SIZE_SHADES: Readonly<Record<ThemeName, readonly string[]>> = {
  light: ["#f87171", "#dc2626", "#b91c1c", "#991b1b"],
  dark: ["#ef4444", "#dc2626", "#b91c1c", "#7f1d1d"],
};

const SIZED_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>(["bet", "raise"]);

export function actionStyle(kind: ActionKind): ActionStyle {
  return ACTION_STYLES[kind];
}

/**
 * The fill color of one action at a node. Bets and raises take a shade by their size rank among
 * the node's sized actions, so two raise sizes never share a color; the size rank is the position
 * of the action among the node's bets and raises sorted by size_cbb ascending.
 */
export function actionColor(action: NodeAction, actions: readonly NodeAction[], theme: ThemeName): string {
  if (!SIZED_KINDS.has(action.kind)) return ACTION_STYLES[action.kind].color[theme];
  const sized = actions
    .filter((candidate) => SIZED_KINDS.has(candidate.kind))
    .map((candidate) => candidate.size_cbb ?? 0)
    .sort((left, right) => left - right);
  const rank = Math.max(0, sized.indexOf(action.size_cbb ?? 0));
  const shades = SIZE_SHADES[theme];
  return shades[Math.min(rank, shades.length - 1)] ?? ACTION_STYLES[action.kind].color[theme];
}
