/**
 * The quiz loop (S27 lane A, S41, R3.16, O-301, O-302, O-285, O-412, O-414): starting the session,
 * then prompt, answer with its reason, result and Next, over usePredictionRun; Previous to review
 * earlier answers; End quiz to finish. Hotkeys go through useHotkey: Enter submits a complete
 * answer (inside the percent field the form's own submit does it; inside the reason it types a
 * newline), N moves on from a result. Both are off while an earlier answer is under review, and
 * Previous has no hotkey. A failure shows one fixed sentence per problem kind (labels.ts), never
 * the server's detail; a stale prompt is replaced by the current one with a notice.
 */
import { useState } from "react";

import { Button, LoadingNote } from "../../components/ui/index.js";
import { useHotkey } from "../../hotkeys/index.js";
import { reviewStep } from "../../prediction/answered.js";
import type { PredictionSource } from "../../prediction/api.js";
import { NEXT_KEY, PREDICTION_SCOPE, PREDICTION_TEXT, SUBMIT_KEY, problemText } from "../../prediction/labels.js";
import { useEndQuiz } from "../../prediction/use-end-quiz.js";
import { usePredictionRun } from "../../prediction/use-prediction-run.js";
import { PromptCard } from "./PromptCard.js";
import { ResultCard } from "./ResultCard.js";
import { ReviewCard } from "./ReviewCard.js";

export interface QuizRunProps {
  source: PredictionSource;
  seed: string | undefined;
  /** Called once the session has ended; the page goes back to the start screen. */
  onEnded: () => void;
}

function Alert({ text }: { text: string }) {
  return (
    <p role="alert" className="text-danger">
      {text}
    </p>
  );
}

export function QuizRun({ source, seed, onEnded }: QuizRunProps) {
  const run = usePredictionRun({ source, seed });
  const quit = useEndQuiz(run.sessionId, onEnded);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const { prompt, draft, result, answered } = run;
  const flavor = source.kind === "quiz" ? "quiz" : "drill";
  useHotkey({ key: SUBMIT_KEY, description: PREDICTION_TEXT.submit, scope: PREDICTION_SCOPE, handler: run.submit }, run.canSubmit && reviewing === null);
  useHotkey({ key: NEXT_KEY, description: PREDICTION_TEXT.next, scope: PREDICTION_SCOPE, handler: run.next }, result !== undefined && reviewing === null);
  const reviewed = reviewing === null ? undefined : answered[reviewing];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {answered.length > 0 && reviewing === null ? (
          <Button size="sm" onClick={() => setReviewing(answered.length - 1)}>
            {PREDICTION_TEXT.previous}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={quit.end} disabled={quit.ending}>
          {quit.ending ? PREDICTION_TEXT.ending : PREDICTION_TEXT.endQuiz}
        </Button>
      </div>
      {quit.failed ? <Alert text={PREDICTION_TEXT.endFailed} /> : null}
      {run.starting ? <LoadingNote text={PREDICTION_TEXT.starting} /> : null}
      {run.error === null || run.error === undefined ? null : <Alert text={problemText(run.error)} />}
      {reviewed === undefined || reviewing === null ? (
        <>
          {run.staleNotice ? <p role="status">{PREDICTION_TEXT.stale}</p> : null}
          {prompt === undefined && run.loadingPrompt ? <LoadingNote text={PREDICTION_TEXT.loadingPrompt} /> : null}
          {prompt === undefined || draft === null ? null : (
            <PromptCard
              prompt={prompt}
              draft={draft}
              reason={run.reason}
              answered={result !== undefined}
              canSubmit={run.canSubmit}
              submitting={run.submitting}
              onDraft={run.setDraft}
              onReason={run.setReason}
              onSubmit={run.submit}
            />
          )}
          {result === undefined ? null : <ResultCard result={result} flavor={flavor} onNext={run.next} />}
        </>
      ) : (
        <ReviewCard
          item={reviewed}
          index={reviewing}
          count={answered.length}
          flavor={flavor}
          onOlder={() => setReviewing(reviewStep(reviewing, answered.length, -1))}
          onNewer={() => setReviewing(reviewStep(reviewing, answered.length, 1))}
          onBack={() => setReviewing(null)}
        />
      )}
    </div>
  );
}
