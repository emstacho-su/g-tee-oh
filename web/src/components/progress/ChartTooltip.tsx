/**
 * The progress charts' tooltip (S32, R4.12, O-320, A7 section 4): shown on hover and on focus,
 * read by screen readers through aria-describedby on its trigger.
 *
 * Mechanism: useTooltipAnchor keeps the trigger's bounding box while it is hovered or focused.
 * ChartTooltip renders at a fixed position from that box, centred above the trigger (below it when
 * the trigger sits near the top of the viewport), so a heat map scrolling inside its card never
 * clips it. The centre is clamped so the tooltip stays on screen at phone width. Colors come from
 * the surface and text tokens, so it reads in both themes.
 */
import { useCallback, useState, type ReactNode } from "react";

import { cn, TOOLTIP_LAYER_CLASS } from "../ui/index.js";

/** Gap in px between the trigger and the tooltip. */
const GAP_PX = 6;
/** Below this many px from the viewport top, the tooltip opens below its trigger. */
const FLIP_BELOW_PX = 120;
/** Half the tooltip's maximum width plus a margin, the closest its centre gets to an edge. */
const EDGE_MARGIN_PX = 112;

export interface TooltipAnchor {
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
}

export interface TooltipAnchorControl {
  anchor: TooltipAnchor | null;
  show: (element: Element) => void;
  hide: () => void;
}

export function useTooltipAnchor(): TooltipAnchorControl {
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);
  const show = useCallback((element: Element) => {
    const box = element.getBoundingClientRect();
    setAnchor({ left: box.left, top: box.top, bottom: box.bottom, width: box.width });
  }, []);
  const hide = useCallback(() => setAnchor(null), []);
  return { anchor, show, hide };
}

export interface ChartTooltipProps {
  id: string;
  anchor: TooltipAnchor | null;
  children: ReactNode;
}

function centreX(anchor: TooltipAnchor): number {
  const centre = anchor.left + anchor.width / 2;
  const viewport = typeof window === "undefined" ? 0 : window.innerWidth;
  if (viewport <= 2 * EDGE_MARGIN_PX) return centre;
  return Math.min(Math.max(centre, EDGE_MARGIN_PX), viewport - EDGE_MARGIN_PX);
}

export function ChartTooltip({ id, anchor, children }: ChartTooltipProps) {
  if (anchor === null) return null;
  const below = anchor.top < FLIP_BELOW_PX;
  const style = below
    ? { left: centreX(anchor), top: anchor.bottom + GAP_PX, transform: "translateX(-50%)" }
    : { left: centreX(anchor), top: anchor.top - GAP_PX, transform: "translate(-50%, -100%)" };
  return (
    <div
      id={id}
      role="tooltip"
      style={style}
      className={cn("pointer-events-none fixed max-w-52 rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-text shadow-md", TOOLTIP_LAYER_CLASS)}
    >
      {children}
    </div>
  );
}
