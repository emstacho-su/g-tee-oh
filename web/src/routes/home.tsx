/**
 * Home page (R3.13, R4.12, A7 section 2). Four cards: today's queue (S32, O-322), streak and
 * rating (S32, the foundation's tiles with the equipped badge, O-323) and builder status. The
 * queue, streak and rating cards live in routes/home-cards/. The builder status card (S28, R3.5,
 * O-290) shows an admin the builder's state and queue depth and links everyone to /library.
 */
import { Link } from "@tanstack/react-router";

import { useAppApi } from "../auth/index.js";
import { Card, PageHeader } from "../components/ui/index.js";
import { BUILDER_STATE_TEXT } from "../library/format.js";
import { useBuilderStatus, useIsAdmin } from "../library/use-builder.js";
import { LoadError } from "./home-cards/LoadError.js";
import { QueueCard } from "./home-cards/QueueCard.js";
import { HomeRatingCard, HomeStreakCard } from "./home-cards/StatCards.js";

export const BUILDER_STATUS_FAILED = "The builder status could not be loaded.";
export const HOME_DESCRIPTION = "What to practise today, your streak and rating, and the library builder.";

function BuilderStatusCard() {
  const isAdmin = useIsAdmin();
  const status = useBuilderStatus(useAppApi(), isAdmin);
  let summary = "Background library builder health is on the Library screen.";
  if (isAdmin && status.data !== undefined) {
    summary = `Builder state: ${BUILDER_STATE_TEXT[status.data.state]}. ${status.data.queue.queued} builds queued.`;
  }
  const failed = isAdmin && status.data === undefined && status.isError;
  return (
    <Card title="Builder status">
      {/* A failed read offers Try again like the other home cards (S47 critic G9). */}
      {failed ? (
        <LoadError message={BUILDER_STATUS_FAILED} retries="the builder status" onRetry={() => void status.refetch()} />
      ) : (
        <p className="text-sm text-muted">{summary}</p>
      )}
      <Link to="/library" className="self-start text-sm font-medium text-accent underline underline-offset-4">
        Open the library
      </Link>
    </Card>
  );
}

/**
 * Layout (S36, O-346): on a wide screen today's queue takes two columns and two rows, the streak
 * and rating stack beside it, and the builder status runs underneath; one column at phone width.
 * Cards keep their own height (items-start), so a short queue leaves no empty card body. Every
 * grid item is min-w-0, so a long line wraps instead of widening the page at 390 px.
 */
export function HomePage() {
  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Home" description={HOME_DESCRIPTION} />
      <div data-testid="home-grid" className="grid gap-4 lg:grid-cols-3 lg:items-start">
        <div className="min-w-0 lg:col-span-2 lg:row-span-2">
          <QueueCard />
        </div>
        <div className="min-w-0">
          <HomeStreakCard />
        </div>
        <div className="min-w-0">
          <HomeRatingCard />
        </div>
        <div className="min-w-0 lg:col-span-3">
          <BuilderStatusCard />
        </div>
      </div>
    </section>
  );
}
