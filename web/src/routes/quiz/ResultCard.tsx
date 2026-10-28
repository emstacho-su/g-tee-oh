/**
 * The result of a quiz answer (S27 lane A, S41, R3.16, O-301, O-410, A7 section 4): right or not
 * as a word and a symbol (colour is never the only signal), the solver's answer in words as the api
 * sent it (its numbers are Rust's, ADR 0004), "Passed Medium at this spot" when the last 20 answers
 * at this spot class, ladder and level pass, the window count, and Next (button or N). A quiz has
 * no unlocks (O-410), so only an old drill-backed session shows the unlock banner. In review there
 * is no Next. No rating, score or grade label: questions are unrated (05 section 8).
 */
import { Button, Panel } from "../../components/ui/index.js";
import type { PredictionResult } from "../../contracts.js";
import { NEXT_KEY, PREDICTION_TEXT, passedText, unlockedText, windowText, type RunFlavor } from "../../prediction/labels.js";

export interface ResultCardProps {
  result: PredictionResult;
  flavor: RunFlavor;
  /** Absent in review: an earlier result has no Next. */
  onNext?: () => void;
}

const RIGHT_MARK = "✓";
const WRONG_MARK = "✗";

export function ResultCard({ result, flavor, onNext }: ResultCardProps) {
  const verdict = result.correct ? PREDICTION_TEXT.correct : PREDICTION_TEXT.incorrect;
  return (
    <section aria-label="Result" data-testid="prediction-result">
      <Panel>
        <p role="status" className="text-lg font-semibold">
          <span aria-hidden="true">{result.correct ? RIGHT_MARK : WRONG_MARK} </span>
          {verdict}
        </p>
        <p>{result.truth.text}</p>
        {result.level_passed ? (
          <p role="note" data-testid="level-passed" className="self-start rounded-lg border border-accent bg-surface-sunken px-3 py-2 font-medium">
            {passedText(result.level)}
          </p>
        ) : null}
        {flavor === "drill" && result.next_level_unlocked ? (
          <p role="note" data-testid="level-unlocked" className="rounded-lg border border-accent bg-surface-sunken px-3 py-2 font-medium">
            {unlockedText(result.ladder, result.new_level)}
          </p>
        ) : null}
        <p className="text-sm text-muted">{windowText(result.window, flavor)}</p>
        {onNext === undefined ? null : (
          <Button variant="primary" className="self-start" onClick={onNext} aria-keyshortcuts={NEXT_KEY.toUpperCase()}>
            <kbd aria-hidden="true" className="font-mono text-xs">
              {NEXT_KEY.toUpperCase()}
            </kbd>
            {PREDICTION_TEXT.next}
          </Button>
        )}
      </Panel>
    </section>
  );
}
