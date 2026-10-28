/**
 * The /paint screen (S27 lane B, R3.17, 05 section 8, O-300, O-302): range painting over a
 * drill-backed range_paint session. Scaffold; lane B builds the drill picker, RangePainter and the
 * graded view.
 */
import type { PracticeSearch } from "../../practice/search.js";

export interface PaintPageProps {
  search: PracticeSearch;
}

export function PaintPage({ search }: PaintPageProps) {
  return (
    <section className="flex flex-col gap-4" data-drill={search.drill ?? ""}>
      <h1 className="text-2xl font-semibold">Range painting</h1>
    </section>
  );
}
