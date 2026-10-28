/**
 * One Ask answer (S27 lane D, R3.20, O-306, O-308, PM3, A7 section 4).
 *
 * Mechanism: the answer is the model's text, so it is untrusted. It renders as one plain text
 * paragraph: React escapes every character, whitespace-pre-line keeps the line breaks, and there
 * is no dangerouslySetInnerHTML and no markdown rendering, so a tag or markdown asterisks show as typed. A cached
 * answer (it spent nothing, O-306) carries a "From the cache" note. An answer the validator could
 * not check carries the api's warning (O-308), prefixed with the word "Warning:" and a symbol, so
 * color is never the only signal; when the api sends no warning text for an unvalidated answer,
 * the same fixed sentence is shown.
 */
import type { AskResult } from "../../contracts.js";
import { EXPLAIN_TEXT } from "../../explain/texts.js";

export interface AskAnswerProps {
  result: AskResult;
}

const WARNING_SYMBOL = "⚠";

function warningOf(result: AskResult): string | null {
  if (result.warning !== null) return result.warning;
  return result.validated ? null : EXPLAIN_TEXT.unvalidated;
}

export function AskAnswer({ result }: AskAnswerProps) {
  const warning = warningOf(result);
  return (
    <div data-testid="ask-answer" data-validated={result.validated} data-cached={result.cached} className="flex flex-col gap-2">
      {warning === null ? null : (
        <p data-testid="ask-warning" className="text-sm text-warning">
          <span aria-hidden="true" className="mr-1">
            {WARNING_SYMBOL}
          </span>
          {`${EXPLAIN_TEXT.warningPrefix} ${warning}`}
        </p>
      )}
      <p data-testid="ask-answer-text" className="whitespace-pre-line">
        {result.text}
      </p>
      {result.cached ? (
        <p data-testid="ask-cached" className="text-sm text-muted">
          {EXPLAIN_TEXT.cachedNote}
        </p>
      ) : null}
    </div>
  );
}
