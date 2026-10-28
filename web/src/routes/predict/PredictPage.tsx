/**
 * The /predict screen (S27 lane A, R3.16, 05 section 8, O-301, O-302): prediction drills over a
 * drill-backed prediction session. Scaffold; lane A builds the drill picker, PredictionPrompt and
 * the result view.
 */
import type { PracticeSearch } from "../../practice/search.js";

export interface PredictPageProps {
  search: PracticeSearch;
}

export function PredictPage({ search }: PredictPageProps) {
  return (
    <section className="flex flex-col gap-4" data-drill={search.drill ?? ""}>
      <h1 className="text-2xl font-semibold">Prediction drills</h1>
    </section>
  );
}
