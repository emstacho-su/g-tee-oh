/**
 * The nav pill list (S36 review): a labelled nav whose list is one row of pills that scrolls
 * sideways at phone width and a column from md up. The Main navigation and the settings section
 * list both render through it; their links spread NAV_PILL_LINK_PROPS into a router Link, so the
 * pill look and the active state are defined once. The active and inactive classes never overlap,
 * so no two utilities compete for one property, and the active pill is raised and bold as well as
 * accent coloured (colour is never the only signal, A7 section 4).
 *
 * At phone width the row says where it goes (S47 critic G2, S48 critic G2 and G10): a cue at each
 * end, a chevron on a fade, shown only while pills lie beyond that edge, read from the row's own
 * scroll position on mount, on scroll and on resize, so the cue never depends on a pill
 * straddling the edge. The aria-current pill is brought into the row on mount and whenever it
 * moves, a pill is added or a pill's text changes (the router sets the attribute, callers add or
 * relabel pills; one MutationObserver sees all three), by scrolling the row alone: the window
 * never moves, so a direct load at 390 shows the open page's pill.
 */
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "./cn.js";
import { FLAT_REST_CLASS, TACTILE_CLASS } from "./tactile.js";

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

/** The measures of the scrolling row that the cues and the reveal read. */
export interface RowMeasure {
  readonly scrollLeft: number;
  readonly clientWidth: number;
  readonly scrollWidth: number;
}

/** A pill's place in the row's content, from the offsets the row and the pill share. */
export interface PillMeasure {
  readonly offsetLeft: number;
  readonly offsetWidth: number;
}

export interface RowOverflow {
  readonly start: boolean;
  readonly end: boolean;
}

/** The room kept between a revealed pill and the row's edge, the row's own side padding. */
export const REVEAL_PAD_PX = 16;
/** A sub-pixel scroll position counts as the edge it is at, on either side (code review round 1, 2). */
const EDGE_TOLERANCE_PX = 1;
const CURRENT_SELECTOR = '[aria-current="page"]';

/** Which ends of the row still have pills beyond them. */
export function overflowOf(row: RowMeasure): RowOverflow {
  const max = row.scrollWidth - row.clientWidth;
  return { start: row.scrollLeft > EDGE_TOLERANCE_PX, end: max > EDGE_TOLERANCE_PX && row.scrollLeft < max - EDGE_TOLERANCE_PX };
}

/**
 * The scrollLeft that brings a pill into the row with the pad, or null when it is in view already.
 * `pillLeft` is the pill's offset within the row's content (its offsetLeft less the row's, both
 * measured from the same offset parent).
 */
export function revealScroll(row: Pick<RowMeasure, "scrollLeft" | "clientWidth">, pill: PillMeasure, rowLeft = 0): number | null {
  const left = pill.offsetLeft - rowLeft - REVEAL_PAD_PX;
  const right = pill.offsetLeft - rowLeft + pill.offsetWidth + REVEAL_PAD_PX;
  if (left < row.scrollLeft) return Math.max(0, left);
  if (right > row.scrollLeft + row.clientWidth) return right - row.clientWidth;
  return null;
}

/** Scrolls the row, never the window, until the aria-current pill is in view. */
function revealCurrent(list: HTMLElement): void {
  const current = list.querySelector<HTMLElement>(CURRENT_SELECTOR);
  if (current === null) return;
  const target = revealScroll(list, current, list.offsetLeft);
  if (target !== null) list.scrollLeft = target;
}

function sameOverflow(left: RowOverflow, right: RowOverflow): boolean {
  return left.start === right.start && left.end === right.end;
}

const PHONE_ROW_CLASSES =
  "flex snap-x snap-mandatory flex-nowrap gap-1 overflow-x-auto scroll-px-4 px-4 py-1 md:flex-col md:snap-none md:overflow-visible md:px-0 md:py-0";
/** A decoration on the nav itself, so it never takes a tap; hidden from md, where the list is a column. */
const CUE_CLASSES = "pointer-events-none absolute inset-y-0 flex w-8 items-center text-lg leading-none text-muted transition-opacity md:hidden";
const CUE_SIDE_CLASSES: Readonly<Record<keyof RowOverflow, string>> = {
  start: "left-0 justify-start bg-gradient-to-r from-surface to-transparent pl-1",
  end: "right-0 justify-end bg-gradient-to-l from-surface to-transparent pr-1",
};
const CUE_GLYPHS: Readonly<Record<keyof RowOverflow, string>> = { start: "‹", end: "›" };

function EdgeCue({ side, shown }: { side: keyof RowOverflow; shown: boolean }) {
  return (
    <span aria-hidden="true" data-testid={`nav-${side}-fade`} data-shown={shown} className={cn(CUE_CLASSES, CUE_SIDE_CLASSES[side], shown ? "opacity-100" : "opacity-0")}>
      {CUE_GLYPHS[side]}
    </span>
  );
}

export function PillNav({ label, className, children }: PillNavProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState<RowOverflow>({ start: false, end: false });
  const measure = useCallback(() => {
    const list = listRef.current;
    if (list === null) return;
    const next = overflowOf(list);
    setMore((previous) => (sameOverflow(previous, next) ? previous : next));
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return undefined;
    revealCurrent(list);
    measure();
    // The router moves aria-current on a navigation; pills arrive (the admin pills once the session
    // resolves) or widen (", needs a fix"); the row follows each (code review round 1, 1).
    const moved = new MutationObserver(() => {
      revealCurrent(list);
      measure();
    });
    moved.observe(list, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-current"] });
    // A resize (a rotation, a wider window) changes what lies beyond the edges; jsdom has no ResizeObserver.
    const resized = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    resized?.observe(list);
    return () => {
      moved.disconnect();
      resized?.disconnect();
    };
  }, [measure]);

  return (
    <nav aria-label={label} className={cn("relative -mx-4 md:mx-0", className)}>
      <ul ref={listRef} className={PHONE_ROW_CLASSES} onScroll={measure}>
        {children}
      </ul>
      <EdgeCue side="start" shown={more.start} />
      <EdgeCue side="end" shown={more.end} />
    </nav>
  );
}
