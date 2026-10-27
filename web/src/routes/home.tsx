/**
 * Home page (R3.13, A7 section 2). Four cards: today's queue, streak, rating and builder status.
 * Their data arrives in later sessions, so each card says which session fills it.
 */
import { useId } from "react";

interface HomeCard {
  title: string;
  summary: string;
  session: string;
}

const HOME_CARDS: readonly HomeCard[] = [
  { title: "Today's queue", summary: "Spots due for review today.", session: "Phase 4 (S32)" },
  { title: "Streak", summary: "Days in a row with training.", session: "S32" },
  { title: "Rating", summary: "Your overall rating and trend.", session: "S32" },
  { title: "Builder status", summary: "Background library builder health.", session: "S28" },
];

function Card({ card }: { card: HomeCard }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-border bg-surface-raised p-4">
      <h2 id={headingId} className="text-lg font-semibold">
        {card.title}
      </h2>
      <p className="text-muted">{card.summary}</p>
      <p className="text-sm text-muted">Filled in {card.session}.</p>
    </section>
  );
}

export function HomePage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Home</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {HOME_CARDS.map((card) => (
          <Card key={card.title} card={card} />
        ))}
      </div>
    </section>
  );
}
