/**
 * Home page (R3.13, R4.12, A7 section 2). Four cards: today's queue (S32, O-322), streak and
 * rating (S32, the foundation's tiles with the equipped badge, O-323) and builder status. The
 * queue, streak and rating cards live in routes/home-cards/. The builder status card (S28, R3.5,
 * O-290) shows an admin the builder's state and queue depth and links everyone to /library.
 */
import { useId, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { useAppApi } from "../auth/index.js";
import { BUILDER_STATE_TEXT } from "../library/format.js";
import { useBuilderStatus, useIsAdmin } from "../library/use-builder.js";
import { QueueCard } from "./home-cards/QueueCard.js";
import { HomeRatingCard, HomeStreakCard } from "./home-cards/StatCards.js";

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
        <QueueCard />
        <HomeStreakCard />
        <HomeRatingCard />
        <BuilderStatusCard />
      </div>
    </section>
  );
}
