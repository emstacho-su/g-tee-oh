/**
 * The painted identity of one action (S24, A7 section 4, R3.12, R3.13): a small box filled with
 * the action's color and hatch pattern, followed by its short letter. Color is never the only
 * signal: the pattern and the letter come from src/theme/action-style.ts as well.
 *
 * Mechanism: actionFillStyle returns inline CSS with the light and dark colors as custom
 * properties (--action-light, --action-dark) and the hatch as a background image; the Tailwind
 * classes in ACTION_FILL_CLASSES pick the color for the current theme (the dark class on <html>).
 * The ActionBar, the RNG strip, the frequency bars and the feedback panel all use it, so an
 * action looks the same everywhere.
 */
import type { CSSProperties } from "react";

import { cn } from "../ui/index.js";
import type { NodeAction } from "../../contracts.js";
import { actionColor, actionStyle, hatchInkFor, type HatchPattern } from "../../theme/action-style.js";

/**
 * The hatch ink is a custom property too (S38): actionFillStyle sets the ink that suits each
 * theme's fill (--hatch-light, --hatch-dark, from hatchInkFor) and ACTION_FILL_CLASSES points
 * --hatch at the current theme's, so the pattern stays visible on deep and on lifted fills.
 */
const INK = "var(--hatch)";

interface PatternFill {
  readonly image: string;
  readonly size?: string;
}

const PATTERN_FILLS: Readonly<Record<HatchPattern, PatternFill>> = {
  none: { image: "none" },
  diagonal: { image: `repeating-linear-gradient(45deg, ${INK} 0 2px, transparent 2px 6px)` },
  reverse: { image: `repeating-linear-gradient(-45deg, ${INK} 0 2px, transparent 2px 6px)` },
  cross: {
    image: `repeating-linear-gradient(45deg, ${INK} 0 1px, transparent 1px 5px), repeating-linear-gradient(-45deg, ${INK} 0 1px, transparent 1px 5px)`,
  },
  vertical: { image: `repeating-linear-gradient(90deg, ${INK} 0 2px, transparent 2px 6px)` },
  horizontal: { image: `repeating-linear-gradient(0deg, ${INK} 0 2px, transparent 2px 6px)` },
  dots: { image: `radial-gradient(${INK} 1px, transparent 1.5px)`, size: "5px 5px" },
};

/** Picks the light or dark fill and hatch ink by theme; pair with actionFillStyle. */
export const ACTION_FILL_CLASSES =
  "bg-(--action-light) [--hatch:var(--hatch-light)] dark:bg-(--action-dark) dark:[--hatch:var(--hatch-dark)]";

type FillProperty = "--action-light" | "--action-dark" | "--hatch-light" | "--hatch-dark";

export function actionFillStyle(action: NodeAction, actions: readonly NodeAction[]): CSSProperties {
  const fill = PATTERN_FILLS[actionStyle(action.kind).pattern];
  const light = actionColor(action, actions, "light");
  const dark = actionColor(action, actions, "dark");
  const colors: Record<FillProperty, string> = {
    "--action-light": light,
    "--action-dark": dark,
    "--hatch-light": hatchInkFor(light),
    "--hatch-dark": hatchInkFor(dark),
  };
  return {
    ...colors,
    backgroundImage: fill.image,
    ...(fill.size === undefined ? {} : { backgroundSize: fill.size }),
  };
}

export interface ActionSwatchProps {
  action: NodeAction;
  /** The node's actions, so two raise sizes take different shades. */
  actions?: readonly NodeAction[];
  /** Hide the short letter when the caller prints it elsewhere. */
  showLetter?: boolean;
  className?: string;
}

export function ActionSwatch({ action, actions = [action], showLetter = true, className }: ActionSwatchProps) {
  const style = actionStyle(action.kind);
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span
        aria-hidden="true"
        data-testid="action-swatch"
        data-pattern={style.pattern}
        style={actionFillStyle(action, actions)}
        className={cn("inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-black/20", ACTION_FILL_CLASSES)}
      />
      {showLetter ? (
        <span aria-hidden="true" className="font-mono text-xs font-bold">
          {style.short}
        </span>
      ) : null}
    </span>
  );
}
