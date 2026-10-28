/**
 * The PracticeSession body of a session row (R3.6, R4.10, R4.13, A5 section 3, O-272, O-276): the
 * S23 fields plus S31's rated_eligible, the automated block and the holdout progress, all read from
 * the persisted state so no request reads anything else to render it. Drill sessions are never
 * rated (05 section 1), holdout sessions neither (O-276), and an automated session created with a
 * client-supplied seed is unrated end to end (the PM seed condition).
 */
import type { z } from "zod";

import type { sessionSchema } from "../schemas/training.js";
import type { SessionRow } from "./repository.js";
import { learningOf } from "./state.js";

export type Session = z.infer<typeof sessionSchema>;

export function toSession(row: SessionRow): Session {
  const learning = learningOf(row.state);
  const base = {
    session_id: row.id,
    mode: row.mode,
    drill_id: row.drillId,
    state: row.state.phase,
    state_version: row.stateVersion,
    started_at: row.startedAt.toISOString(),
  };
  if (learning?.kind === "automated") {
    const { block } = learning;
    return {
      ...base,
      rated_eligible: !learning.seeded,
      automated: {
        spot_class_key: block.spot_class_key,
        track_key: block.track_key,
        family: block.family,
        served: block.served,
        size: block.size,
        worked_example: block.worked_example,
      },
      holdout: null,
    };
  }
  if (learning?.kind === "holdout") {
    return {
      ...base,
      rated_eligible: false,
      automated: null,
      holdout: { round_month: learning.round_month, answered: learning.answered, total: learning.total },
    };
  }
  return { ...base, rated_eligible: false, automated: null, holdout: null };
}
