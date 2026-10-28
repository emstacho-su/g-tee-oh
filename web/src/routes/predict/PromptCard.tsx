/**
 * One prediction prompt (S27 lane A, R3.16, O-301, O-57): the ladder and level badge ("Range level
 * 2 of 3"), the spot (the hero's seat, the action so far, the hand on the hand ladder), the
 * question, the synthetic banner when the solution is a fixture, and the answer input inside a
 * form whose submit is the Submit button or Enter. No strategy number is shown before the answer
 * (predict before peek, O-302): the prompt carries none.
 */
import type { FormEvent } from "react";

import { Button, SyntheticBanner } from "../../components/ui/index.js";
import type { PredictionPrompt } from "../../contracts.js";
import type { AnswerDraft } from "../../prediction/draft.js";
import { PREDICTION_TEXT, SUBMIT_KEY, levelBadge } from "../../prediction/labels.js";
import { AnswerInput } from "./AnswerInput.js";

export interface PromptCardProps {
  prompt: PredictionPrompt;
  draft: AnswerDraft;
  answered: boolean;
  canSubmit: boolean;
  submitting: boolean;
  onDraft: (draft: AnswerDraft) => void;
  onSubmit: () => void;
}

function SpotLine({ prompt }: { prompt: PredictionPrompt }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="text-muted">Seat</dt>
      <dd>{prompt.hero_position}</dd>
      <dt className="text-muted">{PREDICTION_TEXT.historyLabel}</dt>
      <dd>{prompt.history.length === 0 ? "None" : prompt.history.map((entry) => `${entry.position} ${entry.label}`).join(", ")}</dd>
      {prompt.hand === null ? null : (
        <>
          <dt className="text-muted">Hand</dt>
          <dd className="font-mono">{prompt.hand}</dd>
        </>
      )}
    </dl>
  );
}

export function PromptCard({ prompt, draft, answered, canSubmit, submitting, onDraft, onSubmit }: PromptCardProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form aria-labelledby="prediction-question" onSubmit={submit} className="flex flex-col gap-4 rounded-md border border-border bg-surface-raised p-4">
      {prompt.synthetic ? <SyntheticBanner /> : null}
      <p className="self-start rounded-full border border-border px-3 py-1 text-xs font-semibold" data-testid="level-badge">
        {levelBadge(prompt.ladder, prompt.level)}
      </p>
      <SpotLine prompt={prompt} />
      <h2 id="prediction-question" className="text-lg font-semibold">
        {prompt.question}
      </h2>
      <AnswerInput prompt={prompt} draft={draft} disabled={answered || submitting} onChange={onDraft} />
      {answered ? null : (
        <Button type="submit" variant="primary" className="self-start" disabled={!canSubmit} aria-keyshortcuts={SUBMIT_KEY}>
          {submitting ? PREDICTION_TEXT.submitting : PREDICTION_TEXT.submit}
        </Button>
      )}
    </form>
  );
}
