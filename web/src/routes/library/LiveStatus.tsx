/**
 * The live update line of /library (S28, R3.4, O-297): whether the event stream is on, a
 * reconnect button once the browser has given up on it, and the newest coverage_added for this
 * configuration in a polite live region, so a screen reader hears it without losing focus.
 */
import { Button } from "../../components/ui/index.js";
import type { CoverageAddedEvent } from "../../library/events.js";
import { capitalize, pairWords } from "../../progress/spot-words.js";
import type { StreamStatus } from "../../library/use-server-events.js";

const STATUS_TEXT: Readonly<Record<StreamStatus, string>> = {
  connecting: "Connecting to live updates.",
  open: "Live updates are on.",
  closed: "Live updates stopped.",
};

export interface LiveStatusProps {
  status: StreamStatus;
  onReconnect: () => void;
  latest: CoverageAddedEvent | null;
}

export function LiveStatus({ status, onReconnect, latest }: LiveStatusProps) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-center gap-2">
        <span data-testid="live-status" className="text-muted">
          {STATUS_TEXT[status]}
        </span>
        {status === "closed" ? (
          <Button size="sm" onClick={onReconnect}>
            Reconnect
          </Button>
        ) : null}
      </div>
      <p aria-live="polite" data-testid="live-coverage" className="font-medium">
        {latest === null ? "" : `New coverage: ${capitalize(pairWords(latest.pair))} on ${latest.flop}, ${latest.scenario_count} scenarios (pre-dealt runouts).`}
      </p>
    </div>
  );
}
