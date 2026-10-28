/**
 * The study browser, /study (S25, R3.12, A7 sections 2 and 4, O-286).
 * SCAFFOLD: Lane A builds the screen; the route and its validated search are wired.
 */
import type { StudySearch } from "../../study/search.js";

export interface StudyPageProps {
  search: StudySearch;
}

export function StudyPage({ search }: StudyPageProps) {
  return (
    <section className="space-y-2" data-pair={search.pair}>
      <h1 className="text-2xl font-semibold">Solution browser</h1>
    </section>
  );
}
