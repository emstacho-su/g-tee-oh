/**
 * The prediction loop for one drill (S27 lane A, R3.16, O-301, O-302, O-285): starting the
 * session, then prompt, answer, result and Next, over usePredictionRun. Hotkeys go through
 * useHotkey: Enter submits a complete answer (inside the percent field the form's own submit does
 * it), N moves on from a result. A failure shows one fixed sentence per problem kind (labels.ts),
 * never the server's detail; a stale prompt is replaced by the current one with a notice.
 */
import { LoadingNote } from "../../components/ui/index.js";
import { useHotkey } from "../../hotkeys/index.js";
import { NEXT_KEY, PREDICTION_SCOPE, PREDICTION_TEXT, SUBMIT_KEY, problemText } from "../../prediction/labels.js";
import { usePredictionRun } from "../../prediction/use-prediction-run.js";
import { PromptCard } from "./PromptCard.js";
import { ResultCard } from "./ResultCard.js";

export interface PredictionRunProps {
  drillId: string;
  seed: string | undefined;
}

export function PredictionRun({ drillId, seed }: PredictionRunProps) {
  const run = usePredictionRun({ drillId, seed });
  const { prompt, draft, result } = run;
  useHotkey({ key: SUBMIT_KEY, description: PREDICTION_TEXT.submit, scope: PREDICTION_SCOPE, handler: run.submit }, run.canSubmit);
  useHotkey({ key: NEXT_KEY, description: PREDICTION_TEXT.next, scope: PREDICTION_SCOPE, handler: run.next }, result !== undefined);
  return (
    <div className="flex flex-col gap-4">
      {run.starting ? <LoadingNote text={PREDICTION_TEXT.starting} /> : null}
      {run.error === null || run.error === undefined ? null : (
        <p role="alert" className="text-danger">
          {problemText(run.error)}
        </p>
      )}
      {run.staleNotice ? <p role="status">{PREDICTION_TEXT.stale}</p> : null}
      {prompt === undefined && run.loadingPrompt ? <LoadingNote text={PREDICTION_TEXT.loadingPrompt} /> : null}
      {prompt === undefined || draft === null ? null : (
        <PromptCard
          prompt={prompt}
          draft={draft}
          answered={result !== undefined}
          canSubmit={run.canSubmit}
          submitting={run.submitting}
          onDraft={run.setDraft}
          onSubmit={run.submit}
        />
      )}
      {result === undefined ? null : <ResultCard result={result} onNext={run.next} />}
    </div>
  );
}
