/**
 * The result of a prediction answer (S27 lane A, R3.16, O-301, A7 section 4): right or not as a
 * word and a symbol (color is never the only signal), the solver's answer in words as the api sent
 * it (its numbers are Rust's, ADR 0004), the unlock banner when this answer unlocked the next
 * level, the window count, and Next (button or N). No rating, score or grade label: predictions
 * are unrated (05 section 8).
 */
import { Button } from "../../components/ui/index.js";
import type { PredictionResult } from "../../contracts.js";
import { NEXT_KEY, PREDICTION_TEXT, unlockedText, windowText } from "../../prediction/labels.js";

export interface ResultCardProps {
  result: PredictionResult;
  onNext: () => void;
}

const RIGHT_MARK = "✓";
const WRONG_MARK = "✗";

export function ResultCard({ result, onNext }: ResultCardProps) {
  const verdict = result.correct ? PREDICTION_TEXT.correct : PREDICTION_TEXT.incorrect;
  return (
    <section aria-label="Result" data-testid="prediction-result" className="flex flex-col gap-3 rounded-md border border-border bg-surface-raised p-4">
      <p role="status" className="text-lg font-semibold">
        <span aria-hidden="true">{result.correct ? RIGHT_MARK : WRONG_MARK} </span>
        {verdict}
      </p>
      <p>{result.truth.text}</p>
      {result.next_level_unlocked ? (
        <p role="note" data-testid="level-unlocked" className="rounded-md border border-accent bg-surface-sunken px-3 py-2 font-medium">
          {unlockedText(result.ladder, result.new_level)}
        </p>
      ) : null}
      <p className="text-sm text-muted">{windowText(result.window)}</p>
      <Button variant="primary" className="self-start" onClick={onNext} aria-keyshortcuts={NEXT_KEY.toUpperCase()}>
        <kbd aria-hidden="true" className="font-mono text-xs">
          {NEXT_KEY.toUpperCase()}
        </kbd>
        {PREDICTION_TEXT.next}
      </Button>
    </section>
  );
}
