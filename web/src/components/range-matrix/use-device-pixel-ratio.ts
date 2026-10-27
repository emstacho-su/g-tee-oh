/**
 * The current device pixel ratio as React state (S24, R3.12, O-260).
 *
 * Mechanism: the ratio changes when a window moves to a screen with another density or the
 * user zooms the page. The hook reads window.devicePixelRatio once at mount, then listens on the
 * media query (resolution: <ratio>dppx), which stops matching and fires a change event as soon as
 * the ratio leaves that value. Because the query names the old ratio, the effect re-subscribes
 * with a fresh query after every change, and its cleanup removes the listener on unmount. A
 * browser without matchMedia keeps the ratio read at mount. An unusable ratio (not a positive
 * finite number) reads as 1.
 */
import { useEffect, useState } from "react";

const FALLBACK_RATIO = 1;

export function readPixelRatio(): number {
  const ratio = window.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : FALLBACK_RATIO;
}

export function useDevicePixelRatio(): number {
  const [ratio, setRatio] = useState(readPixelRatio);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(`(resolution: ${ratio}dppx)`);
    const onChange = (): void => setRatio(readPixelRatio());
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [ratio]);

  return ratio;
}
