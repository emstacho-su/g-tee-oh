/**
 * One quiz prompt (S27 lane A, S41, R3.16, O-301, O-57, O-412, O-414): the ladder and level badge
 * ("Range level 2 of 3", with the difficulty's name beside it for a quiz session), the spot (the hero's seat, the action so far, the hand on the hand
 * ladder), the question, the synthetic banner when the solution is a fixture, the answer input and
 * the required reason inside a form whose submit is the Submit button or Enter outside the reason.
 * Enter on the answer's own controls is the form's to decide (answer-enter.ts): the chosen option
 * or a ticked region submits a complete answer, an unchosen one is picked (PR #49 review round 2).
 * No strategy number is shown before the answer (predict before peek, O-302): the prompt carries
 * none. In review (readOnly) the same card shows an earlier answer: every input disabled with the
 * answer filled, the reason as text, no Submit.
 */
import type { FormEvent, KeyboardEvent } from "react";

import { Button, Panel, SyntheticBanner } from "../../components/ui/index.js";
import type { PredictionPrompt } from "../../contracts.js";
import type { AnswerDraft } from "../../prediction/draft.js";
import { PREDICTION_TEXT, SUBMIT_KEY, levelBadge } from "../../prediction/labels.js";
import { answerEnterAction } from "./answer-enter.js";
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
  /** A quiz's difficulty name ("Hard"), shown beside the level badge; absent for a drill-backed run. */
  difficulty?: string;
  /** The api refused the last reason sent (a 400 naming body.rationale). */
  reasonRefused?: boolean;
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

const BADGE_CLASS = "rounded-full border border-border px-3 py-1 text-xs font-semibold";

function Badges({ prompt, difficulty }: { prompt: PredictionPrompt; difficulty: string | undefined }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className={BADGE_CLASS} data-testid="level-badge">
        {levelBadge(prompt.ladder, prompt.level)}
      </p>
      {difficulty === undefined ? null : (
        <p className={BADGE_CLASS} data-testid="difficulty-badge">
          {difficulty}
        </p>
      )}
    </div>
  );
}

export function PromptCard(props: PromptCardProps) {
  const { prompt, draft, reason, answered, canSubmit, submitting, readOnly = false, difficulty, reasonRefused = false, onDraft, onReason, onSubmit } = props;
  const locked = readOnly || answered || submitting;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!readOnly) onSubmit();
  };
  // Enter on the answer's own controls (answer-enter.ts, PR #49 review round 2): the chosen option
  // or a ticked region submits, an unchosen one is picked; the default is prevented, so neither
  // the form's implicit submit nor the page's Enter hotkey runs as well.
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (locked || event.key !== SUBMIT_KEY || event.repeat || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    const action = answerEnterAction(event.target, canSubmit);
    if (action === "pass") return;
    event.preventDefault();
    if (action === "submit") onSubmit();
    else if (action === "pick" && event.target instanceof HTMLElement) event.target.click();
  };
  const questionId = `prediction-question-${readOnly ? "review" : "current"}`;
  return (
    <Panel>
      <form aria-labelledby={questionId} onSubmit={submit} onKeyDown={onKeyDown} className="flex flex-col gap-4">
        {prompt.synthetic ? <SyntheticBanner /> : null}
        <Badges prompt={prompt} difficulty={difficulty} />
        <SpotLine prompt={prompt} />
        <h2 id={questionId} className="text-lg font-semibold">
          {prompt.question}
        </h2>
        <AnswerInput prompt={prompt} draft={draft} disabled={locked} onChange={onDraft} />
        {readOnly ? <ReasonText reason={reason} /> : <ReasonField value={reason} disabled={locked} refused={reasonRefused} onChange={onReason} />}
        {answered || readOnly ? null : (
          <Button type="submit" variant="primary" className="self-start" disabled={!canSubmit} aria-keyshortcuts={SUBMIT_KEY}>
            {submitting ? PREDICTION_TEXT.submitting : PREDICTION_TEXT.submit}
          </Button>
        )}
      </form>
    </Panel>
  );
}
