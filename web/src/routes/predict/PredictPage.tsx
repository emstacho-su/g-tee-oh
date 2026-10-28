/**
 * The /predict screen (S27 lane A, R3.16, 05 section 8, O-301, O-302): prediction drills over a
 * drill-backed prediction session. Without ?drill it shows the drill picker (GET /drills); with
 * ?drill it starts a prediction session for that drill (with the optional ?seed, so a session
 * replays) and runs the prompt, answer and result loop (PredictionRun). Keying the run by drill
 * and seed starts a fresh session when either changes. Predictions are unrated: nothing on this
 * screen shows a rating, score or grade label.
 */
import type { PracticeSearch } from "../../practice/search.js";
import { PREDICTION_TEXT } from "../../prediction/labels.js";
import { DrillPicker } from "./DrillPicker.js";
import { PredictionRun } from "./PredictionRun.js";

export interface PredictPageProps {
  search: PracticeSearch;
}

export function PredictPage({ search }: PredictPageProps) {
  return (
    <section className="flex flex-col gap-4" data-drill={search.drill ?? ""}>
      <h1 className="text-2xl font-semibold">{PREDICTION_TEXT.heading}</h1>
      <p className="text-sm text-muted">{PREDICTION_TEXT.intro}</p>
      {search.drill === undefined ? (
        <DrillPicker />
      ) : (
        <PredictionRun key={`${search.drill}:${search.seed ?? ""}`} drillId={search.drill} seed={search.seed} />
      )}
    </section>
  );
}
