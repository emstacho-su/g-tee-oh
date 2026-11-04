/**
 * The home "Today's queue" card (S32, R4.12, O-322, A7 section 2): the practiced classes due now,
 * the classes never practiced, the three costliest leaks with family, coordinates and current
 * cost, and a Start training link to /train.
 *
 * Mechanism: the counts come from the heat map and leak reads through the pure queue model
 * (progress/queue-model.ts); the leak read uses the default eight weeks, so it shares its cache
 * with /progress. Loading, error (with Try again, which retries the failed reads) and data states;
 * a new account sees zero due, every class new and a note that no leaks are measured yet. Since the
 * S47 follow-up (R4.9, O-488) each leak row has a Drill button, and Start training opens the
 * costliest leak's drill through useOpenDrill; with no leak to drill it stays the link to /train.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { useAppApi } from "../../auth/index.js";
import { DRILL_BUTTON_TEXT, DrillAlert, ProgressCard } from "../../components/progress/index.js";
import { Button, LoadingNote } from "../../components/ui/index.js";
import { useOpenDrill, type DrillTarget, type OpenDrillControl } from "../../progress/open-drill.js";
import { heatmapQuery, leaksQuery } from "../../progress/queries.js";
import {
  buildHomeQueue,
  dueText,
  freshText,
  NO_CLASSES_TEXT,
  NO_LEAKS_TEXT,
  startTarget,
  type HomeQueue,
  type QueueLeak,
} from "../../progress/queue-model.js";
import { DEFAULT_LEAK_WEEKS } from "../../progress/types.js";
import { LoadError } from "./LoadError.js";

export const QUEUE_TITLE = "Today's queue";
export const START_TRAINING = "Start training";

const QUEUE_ORIGIN = "queue";

function LeakRow({ leak, drill }: { leak: QueueLeak; drill: OpenDrillControl }) {
  const target = leak.target;
  const name = leak.where === null ? leak.family : `${leak.family}, ${leak.where}`;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
      <span>
        <span className="font-medium">{leak.family}</span>
        {leak.where === null ? null : <span className="text-muted">, {leak.where}</span>}
      </span>
      <span className="flex items-baseline gap-3">
        <span className="tabular-nums text-muted">{leak.costText}</span>
        {target === null ? null : (
          <Button size="sm" disabled={drill.pendingKey !== null} aria-label={`${DRILL_BUTTON_TEXT}: ${name}`} onClick={() => drill.open(target, QUEUE_ORIGIN)}>
            Drill
          </Button>
        )}
      </span>
    </li>
  );
}

function StartTraining({ target, drill }: { target: DrillTarget | null; drill: OpenDrillControl }) {
  if (target === null) {
    return (
      <Button asChild variant="primary" className="self-start">
        <Link to="/train">{START_TRAINING}</Link>
      </Button>
    );
  }
  return (
    <Button variant="primary" className="self-start" disabled={drill.pendingKey !== null} onClick={() => drill.open(target, QUEUE_ORIGIN)}>
      {START_TRAINING}
    </Button>
  );
}

function QueueBody({ queue, classCount }: { queue: HomeQueue; classCount: number }) {
  const drill = useOpenDrill();
  return (
    <div className="flex flex-col gap-3">
      <DrillAlert text={drill.message?.origin === QUEUE_ORIGIN ? drill.message.text : null} />
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
              <LeakRow key={leak.spotClassKey} leak={leak} drill={drill} />
            ))}
          </ol>
        )}
      </div>
      <StartTraining target={startTarget(queue)} drill={drill} />
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
