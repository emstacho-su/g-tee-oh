/**
 * The smaller parts of the drill run screen (S25, R3.13, O-285, ADR 0018): the session recap from
 * POST /sessions/{id}/end, the end-session confirm dialog the E key and the button open, and the
 * session alert that names a failure with fixed, safe text (spot-problem.ts) and offers Try again
 * only for a transient failure in a session. A failed start needs no button of its own: the start
 * panel's Start is there (a drill with no covered spot says its gaps were queued for the library
 * builder), and a fixed failure in a session leaves End session as the way on.
 */
import { useId } from "react";

import { Button, Dialog } from "../../components/ui/index.js";
import { formatBb } from "../../poker/format.js";
import type { SessionRecap } from "../../trainer/session-types.js";
import { problemMessage, type SpotProblem } from "../../trainer/spot-problem.js";
import { SESSION_TEXT } from "./labels.js";

const SCORE_DECIMALS = 2;

export interface SessionRecapViewProps {
  recap: SessionRecap;
  onStartAnother: () => void;
}

export function SessionRecapView({ recap, onStartAnother }: SessionRecapViewProps) {
  const headingId = useId();
  const rows: readonly (readonly [string, string])[] = [
    ["Decisions", String(recap.decisions)],
    ["Rated decisions", String(recap.rated_decisions)],
    ["Mean score", recap.mean_score === null ? "None rated" : recap.mean_score.toFixed(SCORE_DECIMALS)],
    ["EV loss", formatBb(recap.ev_loss_bb_total)],
  ];
  return (
    <section aria-labelledby={headingId} className="flex max-w-xl flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4">
      <h2 id={headingId} className="text-xl font-semibold">
        {SESSION_TEXT.recapHeading}
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 tabular-nums">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted">{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <Button variant="primary" onClick={onStartAnother} className="self-start">
        {SESSION_TEXT.startAnother}
      </Button>
    </section>
  );
}

export interface EndSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function EndSessionDialog({ open, onOpenChange, onConfirm }: EndSessionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={SESSION_TEXT.confirmTitle} description={SESSION_TEXT.confirmDescription}>
      <div className="flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>{SESSION_TEXT.keepPlaying}</Button>
        <Button variant="danger" onClick={onConfirm}>
          {SESSION_TEXT.endSession}
        </Button>
      </div>
    </Dialog>
  );
}

export interface SessionAlertProps {
  problem: SpotProblem;
  /** Offer Try again: only for a transient failure in a session (spot-problem.ts). */
  canRetry: boolean;
  onRetry: () => void;
}

export function SessionAlert({ problem, canRetry, onRetry }: SessionAlertProps) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-danger px-3 py-2">
      <p className="text-danger">{problemMessage(problem)}</p>
      {canRetry ? <Button onClick={onRetry}>{SESSION_TEXT.retry}</Button> : null}
    </div>
  );
}
