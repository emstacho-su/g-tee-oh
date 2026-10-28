/**
 * The Ask dialog (S27 lane D, R3.20, O-305 to O-308, PM3, A5 section 3).
 *
 * Mechanism: a labelled question box capped at the api's 500 characters (maxLength plus a counter
 * tied to the box through aria-describedby) and a Send button that stays disabled until the
 * question has text. Sending posts the trimmed question through askQuestion with AUTO_CSRF_HEADER
 * and a fresh Idempotency-Key from the trainer deps (O-232), so a retried request is answered
 * once. The answer renders through AskAnswer as plain text. After every answer or refusal the Ask
 * status is invalidated, since the spend moved or the api refused: the 503 ask-disabled and 429
 * ask-cap-reached problems show the same fixed texts the disabled button shows (O-307), and the
 * button under the dialog follows the fresh status. Any other failure is an alert with the HTTP
 * status only. The form lives inside the dialog content, which unmounts on close, so reopening
 * starts empty.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";

import { useAppApi } from "../../auth/index.js";
import { askQuestion, askStatusKey, type AskInput } from "../../explain/queries.js";
import { ASK_QUESTION_MAX_CHARS, askProblemText, EXPLAIN_TEXT, questionCounterText } from "../../explain/texts.js";
import { useTrainerDeps } from "../../trainer/trainer-deps.js";
import { failureReason } from "../trainer/FeedbackQueryState.js";
import { Button, Dialog, LoadingNote } from "../ui/index.js";
import { AskAnswer } from "./AskAnswer.js";

export interface AskDialogProps {
  attemptId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AskFailureProps {
  error: unknown;
}

function AskFailure({ error }: AskFailureProps) {
  const text = askProblemText(error) ?? `${EXPLAIN_TEXT.answerSubject} could not load (${failureReason(error)}).`;
  return (
    <p role="alert" className="text-sm text-danger">
      {text}
    </p>
  );
}

interface AskFormProps {
  attemptId: string;
}

function useAskMutation() {
  const api = useAppApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AskInput) => askQuestion(api, input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: askStatusKey() }),
  });
}

function AskForm({ attemptId }: AskFormProps) {
  const { newKey } = useTrainerDeps();
  const mutation = useAskMutation();
  const [question, setQuestion] = useState("");
  const boxId = useId();
  const counterId = useId();
  const trimmed = question.trim();
  const canSend = trimmed !== "" && !mutation.isPending;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    mutation.mutate({ attemptId, question: trimmed, idempotencyKey: newKey() });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label htmlFor={boxId} className="text-sm font-medium">
        {EXPLAIN_TEXT.questionLabel}
      </label>
      <textarea
        id={boxId}
        value={question}
        maxLength={ASK_QUESTION_MAX_CHARS}
        rows={3}
        aria-describedby={counterId}
        onChange={(event) => setQuestion(event.target.value)}
        className="rounded-md border border-border-strong bg-surface p-2 text-sm text-text"
      />
      <p id={counterId} data-testid="ask-counter" className="text-xs text-muted tabular-nums">
        {questionCounterText(question.length)}
      </p>
      <Button type="submit" variant="primary" disabled={!canSend} className="self-start">
        {EXPLAIN_TEXT.send}
      </Button>
      {mutation.isPending ? <LoadingNote text={EXPLAIN_TEXT.sending} /> : null}
      {mutation.isError ? <AskFailure error={mutation.error} /> : null}
      {mutation.isSuccess ? <AskAnswer result={mutation.data} /> : null}
    </form>
  );
}

export function AskDialog({ attemptId, open, onOpenChange }: AskDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={EXPLAIN_TEXT.askTitle} description={EXPLAIN_TEXT.askDescription}>
      <AskForm attemptId={attemptId} />
    </Dialog>
  );
}
