/**
 * Small notices of the study screen (S25, R3.12, A7 section 4): the noise flags as text chips (now in components/panels), the
 * postflop note (O-196) and the failure alert with its optional retry. The synthetic banner and
 * the loading note are the shared ones in components/ui. Every string goes through React text
 * nodes; a failure shows only the fixed message from problem-text.ts, never server detail. Color
 * is never the only signal: each notice says what it is.
 */
import type { Street } from "../../contracts.js";
import { Button } from "../../components/ui/index.js";
import type { StudyFailure } from "../../study/problem-text.js";

// The chips moved to components/panels/NoiseFlags.tsx in S27 so the feedback panel shares them (R3.18).
export { NoiseFlags } from "../../components/panels/NoiseFlags.js";
export type { NoiseFlagsProps } from "../../components/panels/NoiseFlags.js";

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
