/**
 * Autostart (S47, R3.36, O-484): when the run screen opens with ?start=1 (a drill row's Start, the
 * builder's Save and run), the session starts by itself once the drill is read and the machine is
 * idle, exactly once, and the flag is dropped from the address with a replace navigation (the
 * ?saved=1 precedent in DrillForm.tsx), so Back, a reload or a copied link never starts another.
 * The drill is still read first: nothing starts on an id alone.
 */
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { describeFailureForLog } from "../../api/http-status.js";

export interface AutostartOptions {
  /** The address carried start=1. */
  enabled: boolean;
  /** The drill is read and the machine is idle, so a start is what Start would do. */
  ready: boolean;
  start: () => void;
}

export function useAutostart({ enabled, ready, start }: AutostartOptions): void {
  const navigate = useNavigate();
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || !ready || started.current) return;
    started.current = true;
    start();
    navigate({ to: ".", search: (previous: Record<string, unknown>) => withoutStart(previous), replace: true }).catch((error: unknown) => {
      console.error(`g-tee-oh: dropping start=1 from the run address failed (${describeFailureForLog(error)})`);
    });
  }, [enabled, ready, start, navigate]);
}

function withoutStart(search: Record<string, unknown>): Record<string, unknown> {
  const { start: _start, ...rest } = search;
  return rest;
}
