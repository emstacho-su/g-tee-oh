/**
 * Which address may mount a practice run: the one the player pressed Start for, and only until the
 * address leaves it (S41, R3.16, R3.17, O-419, PR #39 security LOW 2, PR #41 review round 1, finding
 * 4). Shared by /quiz and /paint. A link only prefills; this hook is the one way a run mounts, and a
 * mounted run is the one thing that posts POST /sessions (use-practice-session.ts).
 *
 * Mechanism: an arm is a canonical address key, the run key of the validated search, so a Start
 * and the address it lands on are compared the same way. Start navigates first and arms only once
 * that navigation has landed on its key, read from the router's own location (the page's props may
 * lag a render behind); a navigation that never lands, or lands elsewhere because another one
 * overtook it, arms nothing, so no pending arm can wait for a later visit. A drill link's start card
 * arms the address it is already on. Every later change of the address that does not land on the
 * arm clears it, so browser Back or Forward to a started address shows the start screen and never
 * starts again. Ending the session when the run unmounts is the run's own job.
 */
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { describeFailureForLog } from "../api/http-status.js";

export interface StartArmInput {
  /** The page's route path, such as "/quiz". */
  pathname: string;
  /** The run key of the current, validated address; null when it names nothing to run. */
  currentKey: string | null;
  /** The run key of a raw search, validated the way the route validates it. */
  keyOf: (search: Record<string, unknown>) => string | null;
}

export interface StartArm {
  /** True while the address holds the armed key: the run may mount. */
  running: boolean;
  /** Start pressed: arm the key once the Start's navigation has landed on it. */
  startAfter: (navigation: Promise<void>, key: string | null) => void;
  /** Start pressed on the address already shown (a drill link's start card). */
  startHere: () => void;
  /** Drops the arm (End quiz, Back to the start screen). */
  disarm: () => void;
}

export function useStartArm({ pathname, currentKey, keyOf }: StartArmInput): StartArm {
  const router = useRouter();
  const [armed, setArmed] = useState<string | null>(null);
  const seen = useRef(currentKey);

  useEffect(() => {
    if (seen.current === currentKey) return;
    seen.current = currentKey;
    setArmed((key) => (key === currentKey ? key : null));
  }, [currentKey]);

  const landedKey = useCallback((): string | null => {
    const { location } = router.state;
    return location.pathname === pathname ? keyOf({ ...(location.search as Record<string, unknown>) }) : null;
  }, [router, pathname, keyOf]);

  const startAfter = useCallback(
    (navigation: Promise<void>, key: string | null) => {
      navigation.then(
        () => {
          if (key !== null && landedKey() === key) setArmed(key);
        },
        (error: unknown) => console.error(`g-tee-oh: the practice start navigation failed (${describeFailureForLog(error)})`),
      );
    },
    [landedKey],
  );
  const startHere = useCallback(() => setArmed(currentKey), [currentKey]);
  const disarm = useCallback(() => setArmed(null), []);

  return { running: armed !== null && armed === currentKey, startAfter, startHere, disarm };
}
