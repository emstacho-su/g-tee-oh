/**
 * /progress (S32, R4.12, A7 sections 2 and 3, 06 section 7, O-320, O-321, O-326): the rating card
 * and the streak side by side on a wide screen, then the track breakdown, the leak-cost trend, the
 * mastery heat map and the holdout card; one column at phone width.
 *
 * Mechanism: each card reads its own query (src/progress/queries.ts), so each has its own loading
 * note, its own error with a Try again button that refetches only that read, and its data state;
 * a slow read never blanks the others. Data already on screen stays while a refetch runs. The leak
 * trend's weeks live here, and a weeks change keeps the previous trend until the new one lands.
 * The track names from the tracks read name the tracks on the rating and holdout cards. A click to
 * drill from the trend or the heat map goes through useOpenDrill (O-321), whose pending key
 * disables the clicked button and whose message shows in the card that asked.
 */
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { useAppApi } from "../../auth/index.js";
import { HoldoutCard, LeakTrendChart, MasteryHeatMap, ProgressCard, RatingCard, StreakBadge, TrackBreakdown } from "../../components/progress/index.js";
import { Button, LoadingNote } from "../../components/ui/index.js";
import { useOpenDrill, type DrillOrigin, type DrillTarget } from "../../progress/open-drill.js";
import { heatmapQuery, holdoutQuery, leaksQuery, ratingQuery, streakQuery, tracksQuery } from "../../progress/queries.js";
import { DEFAULT_LEAK_WEEKS, type LeakWeeks, type TrackKey, type TrackProgress } from "../../progress/types.js";

export const TRY_AGAIN_TEXT = "Try again";

interface CardQueryProps<T> {
  title: string;
  /** Lower-case words for the loading and error lines ("the leak trend"). */
  subject: string;
  testId: string;
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}

function CardQuery<T>({ title, subject, testId, query, children }: CardQueryProps<T>) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError) {
    return (
      <ProgressCard title={title} testId={testId}>
        <p role="alert" className="text-sm text-danger">
          Could not load {subject}.
        </p>
        <div>
          <Button onClick={() => void query.refetch()}>{TRY_AGAIN_TEXT}</Button>
        </div>
      </ProgressCard>
    );
  }
  return (
    <ProgressCard title={title} testId={testId}>
      <LoadingNote text={`Loading ${subject}`} />
    </ProgressCard>
  );
}

function namesOf(tracks: readonly TrackProgress[] | undefined): Partial<Record<TrackKey, string>> | undefined {
  return tracks === undefined ? undefined : Object.fromEntries(tracks.map((track) => [track.track_key, track.name]));
}

export function ProgressPage() {
  const api = useAppApi();
  const [weeks, setWeeks] = useState<LeakWeeks>(DEFAULT_LEAK_WEEKS);
  const rating = useQuery(ratingQuery(api));
  const tracks = useQuery(tracksQuery(api));
  const leaks = useQuery({ ...leaksQuery(api, weeks), placeholderData: keepPreviousData });
  const heatmap = useQuery(heatmapQuery(api));
  const holdout = useQuery(holdoutQuery(api));
  const streak = useQuery(streakQuery(api));
  const drill = useOpenDrill();
  const trackNames = namesOf(tracks.data);
  const drillFrom = (origin: DrillOrigin) => (target: DrillTarget) => drill.open(target, origin);
  const messageFor = (origin: DrillOrigin) => (drill.message?.origin === origin ? drill.message.text : null);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Progress</h1>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CardQuery title="Rating" subject="the rating" testId="rating-card" query={rating}>
          {(data) => <RatingCard rating={data} {...(trackNames === undefined ? {} : { trackNames })} />}
        </CardQuery>
        <CardQuery title="Streak" subject="the streak" testId="streak-badge" query={streak}>
          {(data) => <StreakBadge streak={data} />}
        </CardQuery>
      </div>
      <CardQuery title="Tracks" subject="the tracks" testId="track-breakdown" query={tracks}>
        {(data) => <TrackBreakdown tracks={data} />}
      </CardQuery>
      <CardQuery title="Leak cost trend" subject="the leak trend" testId="leak-trend" query={leaks}>
        {(data) => (
          <LeakTrendChart
            leaks={data}
            heatmap={heatmap.data}
            weeks={weeks}
            onWeeksChange={setWeeks}
            onDrill={drillFrom("leaks")}
            pendingKey={drill.pendingKey}
            message={messageFor("leaks")}
          />
        )}
      </CardQuery>
      <CardQuery title="Mastery heat map" subject="the heat map" testId="mastery-heatmap" query={heatmap}>
        {(data) => <MasteryHeatMap heatmap={data} onDrill={drillFrom("heatmap")} pendingKey={drill.pendingKey} message={messageFor("heatmap")} />}
      </CardQuery>
      <CardQuery title="Holdout retest" subject="the holdout rounds" testId="holdout-card" query={holdout}>
        {(data) => <HoldoutCard holdout={data} {...(trackNames === undefined ? {} : { trackNames })} />}
      </CardQuery>
    </section>
  );
}
