/**
 * BuilderHealth (S28, R3.5, A7 section 2, A9 section 4, O-36, O-295, O-299): the admin's view of
 * the background builder. It shows the A9 health items that exist in v1 data: builder state and
 * reason, queue depth, flops per day (one build is one flop), storage against the budget in
 * force, plus the build in progress when a build_progress event has arrived. Last backup (S34) and
 * LLM (large language model) spend this month (S27's Ask path) have no v1 data and show as
 * labeled placeholders. Pause and Resume send the admin write; the state shown is the answer's.
 */
import type { ReactNode } from "react";

import type { BuilderStatus } from "../../contracts.js";
import { numericSetting } from "../../library/builder-settings.js";
import type { BuildProgressEvent } from "../../library/events.js";
import { flopsPerDay, formatBytes, formatPercent } from "../../library/format.js";
import { Button } from "../ui/index.js";

const STATE_TEXT: Readonly<Record<BuilderStatus["state"], string>> = {
  running: "Running",
  paused: "Paused",
  throttled: "Throttled",
  idle: "Idle",
  unknown: "Unknown: the builder has not reported since the api started",
};

export interface BuilderHealthProps {
  status: BuilderStatus;
  progress: BuildProgressEvent | null;
  onSetPaused: (paused: boolean) => void;
  pending: boolean;
  /** A fixed message when the last pause or resume failed. */
  failure: string | null;
}

function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col rounded-md border border-border bg-surface-raised px-3 py-2">
      <dt className="text-xs text-muted">{term}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

function storageText(status: BuilderStatus): string {
  const used = status.storage.library_bytes + status.storage.reference_bytes;
  const budget = numericSetting(status.settings, "budget_bytes");
  const share = budget.value > 0 ? used / budget.value : 0;
  const source = budget.stored ? "" : " (builder default)";
  return `${formatBytes(used)} of ${formatBytes(budget.value)}${source}, ${formatPercent(share)}`;
}

function progressText(progress: BuildProgressEvent): string {
  const gains = progress.exploitability === null ? "not measured yet" : progress.exploitability.map((gain) => `${gain.toFixed(2)}%`).join(" and ");
  return `Line ${progress.line === "" ? "(root)" : progress.line}, iteration ${progress.iteration}, exploitability ${gains} of the pot`;
}

export function BuilderHealth({ status, progress, onSetPaused, pending, failure }: BuilderHealthProps) {
  const paused = status.state === "paused";
  const { queue } = status;
  return (
    <section aria-labelledby="builder-health-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="builder-health-heading" className="text-lg font-semibold">
          Builder health
        </h2>
        <Button variant={paused ? "primary" : "secondary"} disabled={pending} onClick={() => onSetPaused(!paused)}>
          {paused ? "Resume the builder" : "Pause the builder"}
        </Button>
      </div>
      {failure === null ? null : (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Item term="Builder state">
          <span data-testid="builder-state">{STATE_TEXT[status.state]}</span>
          {status.reason === null || status.reason === "" ? null : <span className="block text-xs text-muted">{status.reason}</span>}
        </Item>
        <Item term="Queue depth">{`${queue.queued} queued, ${queue.running} running, ${queue.failed} failed, ${queue.blocked_budget} waiting on budget`}</Item>
        <Item term="Flops per day">{`${flopsPerDay(status.throughput_per_hour)} (last 24 hours)`}</Item>
        <Item term="Storage against budget">{storageText(status)}</Item>
        <Item term="Last backup">Not tracked yet: backups arrive with the Mac deploy (S34)</Item>
        <Item term="LLM spend this month">Not tracked yet: arrives with the Ask path (S27)</Item>
      </dl>
      {progress === null ? null : <p className="text-sm">{`Current build: ${progressText(progress)}`}</p>}
    </section>
  );
}
