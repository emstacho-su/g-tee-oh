/**
 * One quiz prompt (S27 lane A, S41, R3.16, O-301, O-57, O-412, O-414): the ladder and level badge
 * ("Range level 2 of 3"), the spot (the hero's seat, the action so far, the hand on the hand
 * ladder), the question, the synthetic banner when the solution is a fixture, the answer input and
 * the required reason inside a form whose submit is the Submit button or Enter outside the reason.
 * No strategy number is shown before the answer (predict before peek, O-302): the prompt carries
 * none. In review (readOnly) the same card shows an earlier answer: every input disabled with the
 * answer filled, the reason as text, no Submit.
 */
import type { FormEvent } from "react";

import { Button, Panel, SyntheticBanner } from "../../components/ui/index.js";
import type { PredictionPrompt } from "../../contracts.js";
import type { AnswerDraft } from "../../prediction/draft.js";
import { PREDICTION_TEXT, SUBMIT_KEY, levelBadge } from "../../prediction/labels.js";
import { AnswerInput } from "./AnswerInput.js";
import { ReasonField } from "./ReasonField.js";

export interface PromptCardProps {
  prompt: PredictionPrompt;
  draft: AnswerDraft;
  reason: string;
  answered: boolean;
  canSubmit: boolean;
  submitting: boolean;
  /** An earlier answer under review: nothing can be changed or sent. */
  readOnly?: boolean;
  onDraft: (draft: AnswerDraft) => void;
  onReason: (reason: string) => void;
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

function ReasonText({ reason }: { reason: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium">{PREDICTION_TEXT.yourReason}</p>
      <p className="whitespace-pre-wrap text-sm">{reason}</p>
    </div>
  );
}

export function PromptCard({ prompt, draft, reason, answered, canSubmit, submitting, readOnly = false, onDraft, onReason, onSubmit }: PromptCardProps) {
  const locked = readOnly || answered || submitting;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!readOnly) onSubmit();
  };
  const questionId = `prediction-question-${readOnly ? "review" : "current"}`;
  return (
    <Panel>
      <form aria-labelledby={questionId} onSubmit={submit} className="flex flex-col gap-4">
        {prompt.synthetic ? <SyntheticBanner /> : null}
        <p className="self-start rounded-full border border-border px-3 py-1 text-xs font-semibold" data-testid="level-badge">
          {levelBadge(prompt.ladder, prompt.level)}
        </p>
        <SpotLine prompt={prompt} />
        <h2 id={questionId} className="text-lg font-semibold">
          {prompt.question}
        </h2>
        <AnswerInput prompt={prompt} draft={draft} disabled={locked} onChange={onDraft} />
        {readOnly ? <ReasonText reason={reason} /> : <ReasonField value={reason} disabled={locked} onChange={onReason} />}
        {answered || readOnly ? null : (
          <Button type="submit" variant="primary" className="self-start" disabled={!canSubmit} aria-keyshortcuts={SUBMIT_KEY}>
            {submitting ? PREDICTION_TEXT.submitting : PREDICTION_TEXT.submit}
          </Button>
        )}
      </form>
    </Panel>
  );
}
