/**
 * The quiz loop (S27 lane A, S41, R3.16, O-301, O-302, O-285, O-411, O-412, O-414): starting the
 * session, then prompt, answer with its reason, result and Next, over usePredictionRun; Previous to
 * review earlier answers; End quiz to finish. Hotkeys go through useHotkey: Enter submits a complete
 * answer (inside the percent field the form's own submit does it; inside the reason it types a
 * newline), N moves on from a result. Both are off while an earlier answer is under review, and
 * Previous has no hotkey. A quiz session names its difficulty beside the level badge; a
 * drill-backed one keeps its header. A failure shows one fixed sentence per problem kind
 * (labels.ts), never the server's detail; a refused reason shows beside the reason field; a stale
 * prompt is replaced by the current one with a notice. A 422 no-quiz-questions, at the start or
 * mid-quiz (O-411 amended), shows the quiz's own sentence (its difficulty, and its kind when it has
 * one) with a way back to the start screen, which ends the session first when there is one.
 * Leaving the run any other way ends its session too (practice/use-practice-session.ts).
 */
import { useState } from "react";

import { Button, LoadingNote, Panel } from "../../components/ui/index.js";
import { useHotkey } from "../../hotkeys/index.js";
import { reviewStep } from "../../prediction/answered.js";
import type { PredictionSource } from "../../prediction/api.js";
import { NEXT_KEY, PREDICTION_SCOPE, PREDICTION_TEXT, SUBMIT_KEY, isNoQuizQuestions, problemText } from "../../prediction/labels.js";
import { noQuestionsText, quizDifficultyName } from "../../prediction/quiz-text.js";
import { useEndQuiz } from "../../prediction/use-end-quiz.js";
import { usePredictionRun } from "../../prediction/use-prediction-run.js";
import { PromptCard } from "./PromptCard.js";
import { ResultCard } from "./ResultCard.js";
import { ReviewCard } from "./ReviewCard.js";

export interface QuizRunProps {
  source: PredictionSource;
  seed: string | undefined;
  /** Called once the session has ended, while the run is still mounted; the page goes back to the start screen. */
  onEnded: () => void;
}

function Alert({ text }: { text: string }) {
  return (
    <p role="alert" className="text-danger">
      {text}
    </p>
  );
}

interface NoQuestionsProps {
  source: PredictionSource;
  error: unknown;
  ending: boolean;
  onBack: () => void;
}

/** The quiz has no question left at its difficulty: say so in its own words and offer the way back. */
function NoQuestions({ source, error, ending, onBack }: NoQuestionsProps) {
  const text = source.kind === "quiz" ? noQuestionsText(source.choice.difficulty, source.choice.kinds) : problemText(error);
  return (
    <div data-testid="no-quiz-questions">
      <Panel>
        <p role="alert">{text}</p>
        <Button variant="primary" className="self-start" onClick={onBack} disabled={ending}>
          {PREDICTION_TEXT.backToStart}
        </Button>
      </Panel>
    </div>
  );
}

export function QuizRun({ source, seed, onEnded }: QuizRunProps) {
  const run = usePredictionRun({ source, seed });
  const quit = useEndQuiz(run.life, onEnded);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const { prompt, draft, result, answered } = run;
  const flavor = source.kind === "quiz" ? "quiz" : "drill";
  const difficulty = source.kind === "quiz" ? { difficulty: quizDifficultyName(source.choice.difficulty) } : {};
  const noQuestions = isNoQuizQuestions(run.error);
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
      {noQuestions ? <NoQuestions source={source} error={run.error} ending={quit.ending} onBack={quit.end} /> : null}
      {run.error === null || run.error === undefined || noQuestions ? null : <Alert text={problemText(run.error)} />}
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
              reasonRefused={run.reasonRefused}
              {...difficulty}
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
          {...difficulty}
          onOlder={() => setReviewing(reviewStep(reviewing, answered.length, -1))}
          onNewer={() => setReviewing(reviewStep(reviewing, answered.length, 1))}
          onBack={() => setReviewing(null)}
        />
      )}
    </div>
  );
}
