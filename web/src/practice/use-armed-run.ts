/**
 * Which address may run a practice session, and what happens when the address leaves it (S41,
 * R3.16, R3.17, PR #39 security LOW 2 and its re-review LOW). Shared by /quiz and /paint.
 *
 * Mechanism: a link only prefills; the player's Start arms exactly one address key, and the run mounts
 * only while the address holds that key. The arm is pending until the address first reaches the
 * key (Start's own navigation may still be in flight), then reached. When the address leaves a
 * reached key, the arm is dropped, so browser Back to the old address shows the start screen and
 * never starts a second session, and the session the run reported is ended (POST
 * /sessions/{id}/end), so leaving by address never strands an open session. The end is best effort:
 * a failure is left to the idle-session closer, which ends any session left open (O-275). Ending
 * from the address change, not from an unmount cleanup, keeps React's development double mount
 * from ending a live session. End quiz and Back to the start screen disarm first: their own end
 * already ran, so nothing is ended twice.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useAppApi } from "../auth/index.js";
import { useTrainerDeps } from "../trainer/trainer-deps.js";
import { endPracticeSession } from "./end-session.js";

interface Arm {
  key: string;
  reached: boolean;
}

export interface ArmedRun {
  /** True while the address holds the armed key: the run may mount. */
  running: boolean;
  /** Arms a key: the player pressed Start for it. */
  arm: (key: string | null) => void;
  /** Drops the arm without ending anything (End quiz, Back to the start screen). */
  disarm: () => void;
  /** The run reports its session id once it has one, so leaving by address can end it. */
  reportSession: (sessionId: string | undefined) => void;
}

export function useArmedRun(currentKey: string | null): ArmedRun {
  const api = useAppApi();
  const { newKey } = useTrainerDeps();
  const [armed, setArmed] = useState<Arm | null>(null);
  const session = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (armed === null) return;
    if (currentKey === armed.key) {
      if (!armed.reached) setArmed({ key: armed.key, reached: true });
      return;
    }
    if (!armed.reached) return;
    const left = session.current;
    session.current = undefined;
    setArmed(null);
    if (left !== undefined) {
      // Best effort (see the module doc): the idle-session closer ends it if this fails.
      endPracticeSession(api, left, newKey()).catch(() => undefined);
    }
  }, [api, armed, currentKey, newKey]);

  const arm = useCallback((key: string | null) => setArmed(key === null ? null : { key, reached: false }), []);
  const disarm = useCallback(() => {
    session.current = undefined;
    setArmed(null);
  }, []);
  const reportSession = useCallback((sessionId: string | undefined) => {
    session.current = sessionId;
  }, []);

  return { running: armed !== null && currentKey !== null && currentKey === armed.key, arm, disarm, reportSession };
}
