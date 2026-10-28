/**
 * The smaller parts of the drill run screen (S25, S38, R3.13, O-285, O-346, ADR 0018): the session
 * recap from POST /sessions/{id}/end, the end-session confirm dialog the E key and the button open,
 * and the session alert that names a failure with fixed, safe text (spot-problem.ts) and offers Try
 * again only for a transient failure in a session. A failed start needs no button of its own: the
 * start panel's Start is there (a drill with no covered spot says its gaps were queued for the
 * library builder), and a fixed failure in a session leaves End session as the way on.
 *
 * S38 restyle: the recap is a raised S36 Card that leads with stat tiles (SessionLook.tsx); the
 * alert sits on the raised ground with the danger edge, its meaning carried by the words (O-366).
 */
import { Button, Card, Dialog, RAISED_CLASS, cn } from "../../components/ui/index.js";
import { formatBb } from "../../poker/format.js";
import type { SessionRecap } from "../../trainer/session-types.js";
import { problemMessage, type SpotProblem } from "../../trainer/spot-problem.js";
import { SESSION_TEXT } from "./labels.js";
import { StatTiles, type StatTile } from "./SessionLook.js";

const SCORE_DECIMALS = 2;

export interface SessionRecapViewProps {
  recap: SessionRecap;
  onStartAnother: () => void;
}

function recapTiles(recap: SessionRecap): StatTile[] {
  return [
    { term: "Decisions", value: String(recap.decisions) },
    { term: "Rated decisions", value: String(recap.rated_decisions) },
    { term: "Mean score", value: recap.mean_score === null ? "None rated" : recap.mean_score.toFixed(SCORE_DECIMALS) },
    { term: "EV loss", value: formatBb(recap.ev_loss_bb_total) },
  ];
}

export function SessionRecapView({ recap, onStartAnother }: SessionRecapViewProps) {
  return (
    <Card title={SESSION_TEXT.recapHeading} testId="session-recap" className="max-w-2xl">
      <StatTiles tiles={recapTiles(recap)} />
      <Button variant="primary" onClick={onStartAnother} className="self-start">
        {SESSION_TEXT.startAnother}
      </Button>
    </Card>
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
      <div className="flex flex-wrap justify-end gap-2">
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
    <div role="alert" className={cn("flex flex-wrap items-center gap-3 rounded-xl border-l-4 border-danger bg-surface-raised px-4 py-3", RAISED_CLASS)}>
      <p className="min-w-0 flex-1 font-medium text-danger">{problemMessage(problem)}</p>
      {canRetry ? (
        <Button size="sm" onClick={onRetry}>
          {SESSION_TEXT.retry}
        </Button>
      ) : null}
    </div>
  );
}
