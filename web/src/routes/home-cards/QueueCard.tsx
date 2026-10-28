/**
 * The home "Today's queue" card (S32, R4.12, O-322, A7 section 2): the practiced classes due now,
 * the classes never practiced, the three costliest leaks with family, coordinates and current
 * cost, and a Start training link to /train.
 *
 * Mechanism: the counts come from the heat map and leak reads through the pure queue model
 * (progress/queue-model.ts); the leak read uses the default eight weeks, so it shares its cache
 * with /progress. Loading, error (with Try again, which retries the failed reads) and data states;
 * a new account sees zero due, every class new and a note that no leaks are measured yet.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { useAppApi } from "../../auth/index.js";
import { ProgressCard } from "../../components/progress/index.js";
import { Button, LoadingNote } from "../../components/ui/index.js";
import { heatmapQuery, leaksQuery } from "../../progress/queries.js";
import {
  buildHomeQueue,
  dueText,
  freshText,
  NO_CLASSES_TEXT,
  NO_LEAKS_TEXT,
  type HomeQueue,
  type QueueLeak,
} from "../../progress/queue-model.js";
import { DEFAULT_LEAK_WEEKS } from "../../progress/types.js";
import { LoadError } from "./LoadError.js";

export const QUEUE_TITLE = "Today's queue";
export const START_TRAINING = "Start training";

function LeakRow({ leak }: { leak: QueueLeak }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
      <span>
        <span className="font-medium">{leak.family}</span>
        {leak.where === null ? null : <span className="text-muted">, {leak.where}</span>}
      </span>
      <span className="tabular-nums text-muted">{leak.costText}</span>
    </li>
  );
}

function QueueBody({ queue, classCount }: { queue: HomeQueue; classCount: number }) {
  return (
    <div className="flex flex-col gap-3">
      {classCount === 0 ? (
        <p className="text-sm text-muted" data-testid="queue-empty">
          {NO_CLASSES_TEXT}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold" data-testid="queue-due">
            {dueText(queue.due)}
          </p>
          <p className="text-sm text-muted" data-testid="queue-new">
            {freshText(queue.fresh)}
          </p>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Top leaks</h3>
        {queue.leaks.length === 0 ? (
          <p className="text-sm text-muted">{NO_LEAKS_TEXT}</p>
        ) : (
          <ol aria-label="Top leaks" className="flex flex-col gap-1">
            {queue.leaks.map((leak) => (
              <LeakRow key={leak.spotClassKey} leak={leak} />
            ))}
          </ol>
        )}
      </div>
      <Button asChild variant="primary" className="self-start">
        <Link to="/train">{START_TRAINING}</Link>
      </Button>
    </div>
  );
}

export function QueueCard() {
  const api = useAppApi();
  const heatmap = useQuery(heatmapQuery(api));
  const leaks = useQuery(leaksQuery(api, DEFAULT_LEAK_WEEKS));
  let body;
  if (heatmap.data !== undefined && leaks.data !== undefined) {
    body = <QueueBody queue={buildHomeQueue(heatmap.data, leaks.data)} classCount={heatmap.data.cells.length} />;
  } else if (heatmap.isError || leaks.isError) {
    const retry = (): void => {
      if (heatmap.isError) void heatmap.refetch();
      if (leaks.isError) void leaks.refetch();
    };
    body = <LoadError message="Today's queue could not be loaded." retries="today's queue" onRetry={retry} />;
  } else {
    body = <LoadingNote text="Loading today's queue." />;
  }
  return (
    <ProgressCard title={QUEUE_TITLE} testId="queue-card">
      {body}
    </ProgressCard>
  );
}
