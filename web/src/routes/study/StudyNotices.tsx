/**
 * Small notices of the study screen (S25, R3.12, A7 section 4): the synthetic banner (O-57), the
 * noise flags as text chips, the postflop note (O-196) and the failure alert with its optional
 * retry. Every string goes through React text nodes; a failure shows only the fixed message from
 * problem-text.ts, never server detail. Color is never the only signal: each notice says what it is.
 */
import type { NoiseFlag, Street } from "../../contracts.js";
import { Button } from "../../components/ui/index.js";
import type { StudyFailure } from "../../study/problem-text.js";

export const SYNTHETIC_TEXT = "Synthetic data: an illustrative fixture, not a solved spot.";

const NOISE_FLAG_TEXT: Readonly<Record<NoiseFlag, string>> = {
  close_ev_mix: "Close EV mix",
  rare_line: "Rare line",
  suit_mixing: "Suit mixing",
};

export function SyntheticBanner() {
  return (
    <p data-testid="synthetic-banner" role="note" className="rounded-md border border-warning bg-surface-sunken px-3 py-2 text-sm font-medium">
      {SYNTHETIC_TEXT}
    </p>
  );
}

export interface NoiseFlagsProps {
  flags: readonly NoiseFlag[];
}

export function NoiseFlags({ flags }: NoiseFlagsProps) {
  if (flags.length === 0) return null;
  return (
    <ul aria-label="Noise flags" className="flex flex-wrap gap-2 text-xs">
      {flags.map((flag) => (
        <li key={flag} className="rounded border border-border bg-surface-sunken px-2 py-0.5">
          {NOISE_FLAG_TEXT[flag]}
        </li>
      ))}
    </ul>
  );
}

export interface PostflopNoteProps {
  street: Street;
}

/** v1 serves preflop only; the postflop matrix needs the O-196 combination aggregation (v1.5). */
export function PostflopNote({ street }: PostflopNoteProps) {
  return <p className="text-muted">{`Postflop study arrives in v1.5. This node is on the ${street}.`}</p>;
}

export interface FailureAlertProps {
  failure: StudyFailure;
  onRetry: () => void;
}

export function FailureAlert({ failure, onRetry }: FailureAlertProps) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-danger px-3 py-2 text-sm">
      <span>{failure.message}</span>
      {failure.retryable ? (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export interface LoadingNoteProps {
  text: string;
}

export function LoadingNote({ text }: LoadingNoteProps) {
  return (
    <p role="status" className="text-sm text-muted">
      {text}
    </p>
  );
}
