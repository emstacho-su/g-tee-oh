/**
 * One quiz prompt (S27 lane A, S41, R3.16, O-301, O-57, O-412, O-414): the ladder and level badge
 * ("Range level 2 of 3", with the difficulty's name beside it for a quiz session), the spot (the hero's seat, the action so far, the hand on the hand
 * ladder), the question, the synthetic banner when the solution is a fixture, the answer input and
 * the required reason inside one form.
 * The form sends only from the Submit button or a plain Enter in the percent field (the submit
 * gate, answer-enter.ts): a modified or held Enter, or Enter on any other control, never submits,
 * whatever the browser's implicit submit does. Each answer option and region checkbox handles its
 * own plain Enter: the chosen one submits a complete answer, an unchosen one is picked (PR #49
 * review rounds 2 to 4).
 * No strategy number is shown before the answer (predict before peek, O-302): the prompt carries
 * none. In review (readOnly) the same card shows an earlier answer: every input disabled with the
 * answer filled, the reason as text, no Submit.
 */
import { useRef, type FormEvent, type KeyboardEvent } from "react";

import { Button, Panel, SyntheticBanner } from "../../components/ui/index.js";
import type { PredictionPrompt } from "../../contracts.js";
import type { AnswerDraft } from "../../prediction/draft.js";
import { PREDICTION_TEXT, SUBMIT_KEY, levelBadge } from "../../prediction/labels.js";
import { isPlainEnter, submitAccepted, type RecordedEnter } from "./answer-enter.js";
import { AnswerInput } from "./AnswerInput.js";
import { ReasonField } from "./ReasonField.js";

/** A zero-delay timer runs once the current task, the keydown with its implicit submit, is over. */
const AFTER_THIS_TASK_MS = 0;

/**
 * The element that sent the form, read without the SubmitEvent global, which older browsers lack
 * (Safari before 15.4): there the gate sees no submitter (PR #49 review round 5).
 */
function submitterOf(event: Event): Element | null {
  return "submitter" in event && event.submitter instanceof Element ? event.submitter : null;
}

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
  // The Enter press under way, for the submit gate (answer-enter.ts, PR #49 review round 4): the
  // browser's implicit submit runs inside the same task as the keydown, so the record is dropped at
  // its keyup, at the submit it causes, or once that task is over, whichever comes first.
  const enterRef = useRef<RecordedEnter | null>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    // The reason field never submits, so its Enter (held for new lines) records nothing (PR #49 round 5).
    if (event.key !== SUBMIT_KEY || event.target instanceof HTMLTextAreaElement) return;
    const recorded: RecordedEnter = { target: event.target, plain: isPlainEnter(event) };
    enterRef.current = recorded;
    window.setTimeout(() => {
      if (enterRef.current === recorded) enterRef.current = null;
    }, AFTER_THIS_TASK_MS);
  };
  const onKeyUp = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === SUBMIT_KEY) enterRef.current = null;
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const enter = enterRef.current;
    enterRef.current = null;
    const submitter = submitterOf(event.nativeEvent);
    if (!readOnly && submitAccepted(enter, submitter)) onSubmit();
  };
  const questionId = `prediction-question-${readOnly ? "review" : "current"}`;
  return (
    <Panel>
      <form aria-labelledby={questionId} onSubmit={submit} onKeyDown={onKeyDown} onKeyUp={onKeyUp} className="flex flex-col gap-4">
        {prompt.synthetic ? <SyntheticBanner /> : null}
        <Badges prompt={prompt} difficulty={difficulty} />
        <SpotLine prompt={prompt} />
        <h2 id={questionId} className="text-lg font-semibold">
          {prompt.question}
        </h2>
        <AnswerInput prompt={prompt} draft={draft} disabled={locked} canSubmit={canSubmit} onChange={onDraft} onSubmit={onSubmit} />
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
