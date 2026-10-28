/**
 * Home page (R3.13, A7 section 2). Four cards: today's queue, streak, rating and builder status.
 * The builder status card (S28, R3.5, O-290) shows an admin the builder's state and queue depth
 * and links everyone to /library; the other cards say which session fills them.
 */
import { useId, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { useAppApi } from "../auth/index.js";
import { BUILDER_STATE_TEXT } from "../library/format.js";
import { useBuilderStatus, useIsAdmin } from "../library/use-builder.js";

interface HomeCard {
  title: string;
  summary: string;
  session: string;
}

const HOME_CARDS: readonly HomeCard[] = [
  { title: "Today's queue", summary: "Spots due for review today.", session: "Phase 4 (S32)" },
  { title: "Streak", summary: "Days in a row with training.", session: "S32" },
  { title: "Rating", summary: "Your overall rating and trend.", session: "S32" },
];

function CardFrame({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-border bg-surface-raised p-4">
      <h2 id={headingId} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Card({ card }: { card: HomeCard }) {
  return (
    <CardFrame title={card.title}>
      <p className="text-muted">{card.summary}</p>
      <p className="text-sm text-muted">Filled in {card.session}.</p>
    </CardFrame>
  );
}

function BuilderStatusCard() {
  const isAdmin = useIsAdmin();
  const status = useBuilderStatus(useAppApi(), isAdmin);
  let summary = "Background library builder health is on the Library screen.";
  if (isAdmin && status.data !== undefined) {
    summary = `Builder state: ${BUILDER_STATE_TEXT[status.data.state]}. ${status.data.queue.queued} builds queued.`;
  } else if (isAdmin && status.isError) {
    summary = "The builder status could not be loaded.";
  }
  return (
    <CardFrame title="Builder status">
      <p className="text-muted">{summary}</p>
      <Link to="/library" className="text-sm underline">
        Open the library
      </Link>
    </CardFrame>
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
        <BuilderStatusCard />
      </div>
    </section>
  );
}
