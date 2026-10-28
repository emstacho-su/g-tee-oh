/**
 * The range matrix pop-out's open cell and its closing rule (S38, R3.12, O-386).
 *
 * Mechanism: the hook holds the grid index of the open pop-out, or null. While one is open it
 * listens for the next click anywhere on the document, in the capture phase so it runs before
 * the click reaches any component: a click on anything but the matrix canvas closes the pop-out
 * (a click inside the pop-out too), and a click on the canvas is left to the canvas, which calls
 * clickCell: the open cell again closes it, another cell moves it there in the same click. The
 * keyboard calls open and close directly. When pop-outs are disabled every call is a no-op.
 */
import { useCallback, useEffect, useState, type RefObject } from "react";

export interface PopOutControl {
  /** The grid index of the open pop-out, or null. */
  readonly index: number | null;
  readonly open: (index: number) => void;
  /** A click on a cell: closes the pop-out on that cell, else opens the cell's. */
  readonly clickCell: (index: number) => void;
  readonly close: () => void;
}

export function usePopOut(enabled: boolean, initialIndex: number | null, canvasRef: RefObject<HTMLCanvasElement | null>): PopOutControl {
  const [index, setIndex] = useState<number | null>(enabled ? initialIndex : null);
  const open = useCallback((next: number) => {
    if (enabled) setIndex(next);
  }, [enabled]);
  const clickCell = useCallback((next: number) => {
    if (enabled) setIndex((current) => (current === next ? null : next));
  }, [enabled]);
  const close = useCallback(() => setIndex(null), []);

  useEffect(() => {
    if (index === null) return undefined;
    const onClick = (event: MouseEvent) => {
      if (event.target !== canvasRef.current) setIndex(null);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [index, canvasRef]);

  return { index: enabled ? index : null, open, clickCell, close };
}
