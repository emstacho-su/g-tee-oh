/**
 * Contract-typed range drift fixtures (S27 lane C, R3.18, O-304): the shown drift of the fixture
 * spot class (FIXTURE_SPOT_CLASS_KEY, the spot class of fixtureFeedback) and a hidden drift for
 * any other class. Synthetic test data: the numbers are invented, the web never computes them
 * (ADR 0004), and the shares only need to be shapes the card formats.
 */
import type { RangeDrift } from "../contracts.js";
import { FIXTURE_SPOT_CLASS_KEY } from "./index.js";

/** Drift is shown from this many decisions (O-304); the api sends it as min_decisions. */
export const FIXTURE_DRIFT_MIN_DECISIONS = 30;
/** The decisions a hidden fixture drift reports so far. */
export const FIXTURE_DRIFT_HIDDEN_DECISIONS = 12;
const FIXTURE_DRIFT_CONFIDENCE = 0.95;

/** The shown drift of the fixture spot class: 42 decisions, a 12.4 percent distance. */
export const fixtureDriftShown: RangeDrift = {
  spot_class_key: FIXTURE_SPOT_CLASS_KEY,
  decisions: 42,
  min_decisions: FIXTURE_DRIFT_MIN_DECISIONS,
  shown: true,
  distance: 0.124,
  ci_low: 0.071,
  ci_high: 0.189,
  confidence: FIXTURE_DRIFT_CONFIDENCE,
  by_kind: [
    { kind: "fold", user_share: 0.43, solver_share: 0.55 },
    { kind: "call", user_share: 0.07, solver_share: 0.05 },
    { kind: "raise", user_share: 0.5, solver_share: 0.38 },
  ],
};

/** A hidden drift for a spot class: below the minimum, so no numbers but the count. */
export function fixtureDriftHiddenFor(spotClassKey: string, decisions: number = FIXTURE_DRIFT_HIDDEN_DECISIONS): RangeDrift {
  return {
    spot_class_key: spotClassKey,
    decisions,
    min_decisions: FIXTURE_DRIFT_MIN_DECISIONS,
    shown: false,
    distance: null,
    ci_low: null,
    ci_high: null,
    confidence: FIXTURE_DRIFT_CONFIDENCE,
    by_kind: [],
  };
}

/** The drift the mock answers for a spot class: shown for the fixture class, hidden otherwise. */
export function fixtureDriftFor(spotClassKey: string): RangeDrift {
  return spotClassKey === FIXTURE_SPOT_CLASS_KEY ? fixtureDriftShown : fixtureDriftHiddenFor(spotClassKey);
}
