/**
 * The nav pill list (S36 review): a labelled nav whose list is one row of pills that scrolls
 * sideways at phone width and a column from md up. The Main navigation and the settings section
 * list both render through it; their links spread NAV_PILL_LINK_PROPS into a router Link, so the
 * pill look and the active state are defined once. The active and inactive classes never overlap,
 * so no two utilities compete for one property, and the active pill is raised and bold as well as
 * accent coloured (colour is never the only signal, A7 section 4).
 *
 * At phone width the row says where it goes (S47 critic G2, S48 critic G2 and G10): the shared
 * edge cues (EdgeCue.tsx) at each end, shown only while pills lie beyond that edge. The
 * aria-current pill is brought into the row on mount and whenever it moves, a pill is added or a
 * pill's text changes (the router sets the attribute, callers add or relabel pills; one
 * MutationObserver sees all three), by scrolling the row alone: the window never moves, so a
 * direct load at 390 shows the open page's pill.
 */
import { useLayoutEffect, type ReactNode } from "react";

import { cn } from "./cn.js";
import { EdgeCue, useEdgeCues } from "./EdgeCue.js";
import { FLAT_REST_CLASS, TACTILE_CLASS } from "./tactile.js";

export { overflowOf } from "./EdgeCue.js";
export type { RowMeasure, RowOverflow } from "./EdgeCue.js";

export const NAV_PILL_LINK_PROPS = {
  className: cn("block whitespace-nowrap rounded-xl px-3 py-2 text-sm", TACTILE_CLASS),
  // aria-current names the open page for assistive tech as well as the raised pill (S47 critic, R3.4).
  activeProps: { className: "bg-surface-raised font-semibold text-accent", "aria-current": "page" },
  inactiveProps: { className: cn("text-text hover:bg-surface-sunken", FLAT_REST_CLASS) },
} as const;

export interface PillNavProps {
  label: string;
  /** Classes for the nav itself (a raised sidebar panel, a width). */
  className?: string;
  /** The list items, each an <li className="shrink-0"> holding one link. */
  children: ReactNode;
}

/** A pill's place in the row's content, from the offsets the row and the pill share. */
export interface PillMeasure {
  readonly offsetLeft: number;
  readonly offsetWidth: number;
}

/** The room kept between a revealed pill and the row's edge, the row's own side padding. */
export const REVEAL_PAD_PX = 16;
const CURRENT_SELECTOR = '[aria-current="page"]';
const CUE_PREFIX = "nav";
/** The cues belong to the phone row; from md the list is a column. */
const CUE_LAYOUT_CLASSES = "md:hidden";

/**
 * The scrollLeft that brings a pill into the row with the pad, or null when it is in view already.
 * `rowLeft` is the row's own offset, so the pill's place is read within the row's content (both
 * measured from the same offset parent).
 */
export function revealScroll(row: { readonly scrollLeft: number; readonly clientWidth: number }, pill: PillMeasure, rowLeft = 0): number | null {
  const left = pill.offsetLeft - rowLeft - REVEAL_PAD_PX;
  const right = pill.offsetLeft - rowLeft + pill.offsetWidth + REVEAL_PAD_PX;
  if (left < row.scrollLeft) return Math.max(0, left);
  if (right > row.scrollLeft + row.clientWidth) return right - row.clientWidth;
  return null;
}

/** True for a change that moves the current pill: aria-current itself, or a pill added to or removed from the row. */
function revealsOn(record: MutationRecord, list: HTMLElement): boolean {
  return record.type === "attributes" || (record.type === "childList" && record.target === list);
}

/** Scrolls the row, never the window, until the aria-current pill is in view. */
function revealCurrent(list: HTMLElement): void {
  const current = list.querySelector<HTMLElement>(CURRENT_SELECTOR);
  if (current === null) return;
  const target = revealScroll(list, current, list.offsetLeft);
  if (target !== null) list.scrollLeft = target;
}

const PHONE_ROW_CLASSES =
  "flex snap-x snap-mandatory flex-nowrap gap-1 overflow-x-auto scroll-px-4 px-4 py-1 md:flex-col md:snap-none md:overflow-visible md:px-0 md:py-0";

export function PillNav({ label, className, children }: PillNavProps) {
  const { ref: listRef, cues, measure } = useEdgeCues<HTMLUListElement>();

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return undefined;
    revealCurrent(list);
    measure();
    // The router moves aria-current on a navigation and pills arrive (the admin pills once the
    // session resolves): both reveal the current pill. A relabel (", needs a fix") only re-measures
    // the cues, so a row the user scrolled away from stays put (code review round 1, 1; round 2, 3).
    const moved = new MutationObserver((records) => {
      if (records.some((record) => revealsOn(record, list))) revealCurrent(list);
      measure();
    });
    moved.observe(list, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-current"] });
    return () => moved.disconnect();
  }, [listRef, measure]);

  return (
    <nav aria-label={label} className={cn("relative -mx-4 md:mx-0", className)}>
      <ul ref={listRef} className={PHONE_ROW_CLASSES} onScroll={measure}>
        {children}
      </ul>
      <EdgeCue side="start" shown={cues.start} prefix={CUE_PREFIX} className={CUE_LAYOUT_CLASSES} />
      <EdgeCue side="end" shown={cues.end} prefix={CUE_PREFIX} className={CUE_LAYOUT_CLASSES} />
    </nav>
  );
}
