/**
 * The position carousel (S39, R3.12, O-354, O-393, O-394): the table's seats in action order as a
 * strip of buttons above the matrix, with the selected seat's actions dropping down under it. It
 * replaces S25's line breadcrumb and line step links.
 *
 * Mechanism: the items come from study/carousel.ts. The current item (the seat to act at the
 * line's node, whose range the matrix shows) is selected: pressing it toggles the drop-down, which
 * starts open (aria-expanded and aria-controls tie it to CarouselActions). An acted item opens the
 * line before that decision (a push, so browser back returns), which makes that seat current and
 * shows its range there. Folded and waiting items stay focusable but aria-disabled, their reason
 * in the accessible name and the tooltip. The strip scrolls sideways inside its own box, padded
 * so the focus ring is never clipped, and whenever the line changes it scrolls the current item
 * to its centre: smoothly, or at once under reduced motion. Only the strip scrolls, never the
 * page. The caller keys the carousel by line, so a new line starts with its drop-down open.
 */
import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { usePrefersReducedMotion } from "../../components/table/reduced-motion.js";
import { Button, cn } from "../../components/ui/index.js";
import type { StudyNode } from "../../contracts.js";
import type { CarouselItem } from "../../study/carousel.js";
import type { ChildStreets } from "../../study/use-line-nodes.js";
import { CarouselActions } from "./CarouselActions.js";

export interface PositionCarouselProps {
  items: readonly CarouselItem[];
  node: Pick<StudyNode, "to_act" | "actions" | "next_likely_line">;
  line: string | undefined;
  /** The known street of each continuing action's child (useChildStreets). */
  childStreets: ChildStreets;
  onOpenLine: (line: string) => void;
}

interface CurrentInView {
  scroller: RefObject<HTMLDivElement | null>;
  current: RefObject<HTMLLIElement | null>;
}

/** Centres the current item in the strip, moving only the strip. */
function useCurrentInView(line: string | undefined, count: number): CurrentInView {
  const scroller = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLLIElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  useEffect(() => {
    const box = scroller.current;
    const item = current.current;
    if (box === null || item === null || typeof box.scrollTo !== "function") return;
    const left = item.offsetLeft - (box.clientWidth - item.offsetWidth) / 2;
    box.scrollTo({ left: Math.max(0, left), behavior: reduceMotion ? "auto" : "smooth" });
  }, [line, count, reduceMotion]);
  return { scroller, current };
}

interface SeatButtonProps {
  item: CarouselItem;
  expanded: boolean;
  actionsId: string;
  onPress: () => void;
}

function SeatButton({ item, expanded, actionsId, onPress }: SeatButtonProps) {
  const isCurrent = item.state === "current";
  const unavailable = item.state === "folded" || item.state === "waiting";
  return (
    <Button
      size="sm"
      variant={isCurrent ? "primary" : "secondary"}
      aria-current={isCurrent ? "step" : undefined}
      aria-expanded={isCurrent ? expanded : undefined}
      aria-controls={isCurrent && expanded ? actionsId : undefined}
      aria-disabled={unavailable ? true : undefined}
      title={item.reason}
      data-state={item.state}
      onClick={onPress}
      className={cn(
        "h-auto min-w-20 flex-col items-start gap-0 py-1.5 text-left",
        unavailable && "cursor-not-allowed border-dashed font-normal text-muted",
      )}
    >
      <span className="flex items-center gap-1 text-sm font-semibold">
        {item.seat}
        {/* S45 (R3.12): the current seat button doubles as the drop-down toggle, so it shows a chevron. */}
        {isCurrent ? (
          <span aria-hidden="true" data-testid="seat-chevron" data-open={expanded ? "true" : "false"} className={cn("inline-block text-xs transition-transform", expanded && "rotate-180")}>
            ▾
          </span>
        ) : null}
      </span>{" "}
      <span className="text-xs font-normal">{item.text}</span>
      {item.reason === undefined ? null : <span className="sr-only">{`, ${item.reason}`}</span>}
    </Button>
  );
}

export function PositionCarousel({ items, node, line, childStreets, onOpenLine }: PositionCarouselProps) {
  const actionsId = useId();
  const [expanded, setExpanded] = useState(true);
  const { scroller, current } = useCurrentInView(line, items.length);

  function press(item: CarouselItem): void {
    if (item.state === "current") setExpanded((open) => !open);
    else if (item.state === "acted" && item.line !== undefined) onOpenLine(item.line);
  }

  return (
    <section aria-label="Position carousel" className="flex min-w-0 flex-col gap-2">
      <div ref={scroller} data-testid="position-strip" className="relative min-w-0 snap-x overflow-x-auto p-1.5">
        <ol aria-label="Positions" className="flex w-max gap-2">
          {items.map((item) => (
            <li key={item.key} ref={item.state === "current" ? current : undefined} className="snap-center">
              <SeatButton item={item} expanded={expanded} actionsId={actionsId} onPress={() => press(item)} />
            </li>
          ))}
        </ol>
      </div>
      {expanded ? <CarouselActions id={actionsId} node={node} line={line} childStreets={childStreets} onOpenLine={onOpenLine} /> : null}
    </section>
  );
}
