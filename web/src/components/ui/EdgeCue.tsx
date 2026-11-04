/**
 * The edge cue of a frame that scrolls sideways (S48, R3.13, R4.19): a chevron on a fade at the
 * start or the end, shown only while content lies beyond that edge, read from the frame's own
 * scroll position on mount, on scroll and on resize, so the cue never depends on a column or a
 * pill straddling the edge (S48 critic G2 on the nav row and the mastery heat map). PillNav's row
 * and the heat map's grid frame share it: the caller gives the frame the hook's ref and onScroll,
 * and draws the two cues beside it inside a relative wrapper.
 */
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { cn } from "./cn.js";

/** The measures of the scrolling frame that the cues read. */
export interface RowMeasure {
  readonly scrollLeft: number;
  readonly clientWidth: number;
  readonly scrollWidth: number;
}

export interface RowOverflow {
  readonly start: boolean;
  readonly end: boolean;
}

/** A sub-pixel scroll position counts as the edge it is at, on either side (code review round 1, 2). */
const EDGE_TOLERANCE_PX = 1;

/** Which ends of the frame still have content beyond them. */
export function overflowOf(row: RowMeasure): RowOverflow {
  const max = row.scrollWidth - row.clientWidth;
  return { start: row.scrollLeft > EDGE_TOLERANCE_PX, end: max > EDGE_TOLERANCE_PX && row.scrollLeft < max - EDGE_TOLERANCE_PX };
}

function sameOverflow(left: RowOverflow, right: RowOverflow): boolean {
  return left.start === right.start && left.end === right.end;
}

export interface EdgeCues<T extends HTMLElement> {
  /** The scrolling frame. */
  readonly ref: RefObject<T | null>;
  readonly cues: RowOverflow;
  /** Re-reads the frame; the caller wires it to onScroll and calls it after its own changes. */
  readonly measure: () => void;
}

/** The cues of a scrolling frame, measured on mount, on resize (ResizeObserver, absent in jsdom) and whenever measure is called. */
export function useEdgeCues<T extends HTMLElement>(): EdgeCues<T> {
  const ref = useRef<T>(null);
  const [cues, setCues] = useState<RowOverflow>({ start: false, end: false });
  const measure = useCallback(() => {
    const frame = ref.current;
    if (frame === null) return;
    const next = overflowOf(frame);
    setCues((previous) => (sameOverflow(previous, next) ? previous : next));
  }, []);
  useLayoutEffect(() => {
    const frame = ref.current;
    if (frame === null) return undefined;
    measure();
    const resized = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    resized?.observe(frame);
    return () => resized?.disconnect();
  }, [measure]);
  return { ref, cues, measure };
}

export interface EdgeCueProps {
  side: keyof RowOverflow;
  shown: boolean;
  /** The test id prefix: "<prefix>-start-fade" and "<prefix>-end-fade". */
  prefix: string;
  /** Classes of the caller's layout, for example md:hidden where the frame stops scrolling. */
  className?: string;
}

/** A decoration beside the frame, so it never takes a tap. */
const CUE_CLASSES = "pointer-events-none absolute inset-y-0 flex w-8 items-center text-lg leading-none text-muted transition-opacity";
const CUE_SIDE_CLASSES: Readonly<Record<keyof RowOverflow, string>> = {
  start: "left-0 justify-start bg-gradient-to-r from-surface to-transparent pl-1",
  end: "right-0 justify-end bg-gradient-to-l from-surface to-transparent pr-1",
};
const CUE_GLYPHS: Readonly<Record<keyof RowOverflow, string>> = { start: "‹", end: "›" };

export function EdgeCue({ side, shown, prefix, className }: EdgeCueProps) {
  return (
    <span
      aria-hidden="true"
      data-testid={`${prefix}-${side}-fade`}
      data-shown={shown}
      className={cn(CUE_CLASSES, CUE_SIDE_CLASSES[side], shown ? "opacity-100" : "opacity-0", className)}
    >
      {CUE_GLYPHS[side]}
    </span>
  );
}
