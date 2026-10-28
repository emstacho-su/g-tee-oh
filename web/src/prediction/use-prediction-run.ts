/**
 * One quiz session on the /quiz screen (S27 lane A, S41, R3.16, O-232, O-302, O-412, O-414).
 *
 * Mechanism: on mount the hook starts a prediction session over its source, an old drill link or
 * the start screen's catalog choice (POST /sessions with mode prediction, the optional seed and one
 * Idempotency-Key kept for the life of the screen, so a repeated start replays instead of opening a
 * second session). The prompt is read through predictionPromptQuery at a local cursor; the answer
 * being composed and its typed reason are held per prompt id (draft.ts), so leaving to review an
 * earlier answer and coming back finds them intact. Submit needs a complete answer and a reason of
 * 3 characters after trimming, and posts both with the prompt's id and state_version and an
 * Idempotency-Key kept per prompt, so a retry of the same answer is recorded once. Each result is
 * appended to the answered list (answered.ts: the prompt as shown, the draft, the reason and the
 * result, newest last, at most 50), which lives only in this hook's state: unmounting the run (End
 * quiz, a sign-out, another address) drops it. The result stays on screen until Next, which moves
 * the cursor. A 409 stale-state answer moves the cursor too, so the current prompt is read again,
 * and a notice says so; every other failure is kept for the screen to show as fixed text.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { HTTP_STATUS, isApiProblem } from "../api/index.js";
import { useAppApi } from "../auth/index.js";
import type { PredictionPrompt, PredictionResult } from "../contracts.js";
import { useTrainerDeps } from "../trainer/trainer-deps.js";
import { appendAnswered, type AnsweredItem } from "./answered.js";
import { answerPrediction, predictionPromptQuery, startPredictionSession, type PredictionSource } from "./api.js";
import { emptyDraft, reasonReady, toAnswer, type AnswerDraft } from "./draft.js";

const STALE_SLUG = "stale-state";

export interface PredictionRunInput {
  source: PredictionSource;
  seed: string | undefined;
}

export interface PredictionRun {
  starting: boolean;
  sessionId: string | undefined;
  prompt: PredictionPrompt | undefined;
  loadingPrompt: boolean;
  draft: AnswerDraft | null;
  setDraft: (draft: AnswerDraft) => void;
  reason: string;
  setReason: (reason: string) => void;
  canSubmit: boolean;
  submitting: boolean;
  submit: () => void;
  result: PredictionResult | undefined;
  next: () => void;
  answered: readonly AnsweredItem[];
  staleNotice: boolean;
  error: unknown;
}

interface Held {
  promptId: string;
  draft: AnswerDraft | null;
  reason: string;
}

interface AnswerCall {
  prompt: PredictionPrompt;
  draft: AnswerDraft;
  reason: string;
}

function isStale(error: unknown): boolean {
  return isApiProblem(error) && error.status === HTTP_STATUS.conflict && error.slug === STALE_SLUG;
}

/** Starts the session once per mounted screen; the key makes a repeated start a replay (O-232). */
function useStart(input: PredictionRunInput) {
  const api = useAppApi();
  const { newKey } = useTrainerDeps();
  const [key] = useState(newKey);
  const start = useMutation({ mutationFn: () => startPredictionSession(api, { source: input.source, seed: input.seed, key }) });
  const requested = useRef(false);
  const { mutate } = start;
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    mutate();
  }, [mutate]);
  return start;
}

/** One Idempotency-Key per prompt id, so a retried answer to the same prompt replays (O-232). */
function usePromptKeys(): (promptId: string) => string {
  const { newKey } = useTrainerDeps();
  const keys = useRef<ReadonlyMap<string, string>>(new Map());
  return (promptId) => {
    const known = keys.current.get(promptId);
    if (known !== undefined) return known;
    const key = newKey();
    keys.current = new Map([...keys.current, [promptId, key]]);
    return key;
  };
}

/** The answer POST; a success joins the answered list, a stale-state failure reads the prompt again. */
function useAnswer(sessionId: string | undefined, onAnswered: (item: AnsweredItem) => void, onStale: () => void) {
  const api = useAppApi();
  const keyFor = usePromptKeys();
  return useMutation({
    mutationFn: ({ prompt, draft, reason }: AnswerCall) => {
      const answer = toAnswer(draft);
      if (answer === null) throw new Error("an incomplete answer cannot be sent");
      const body = { prompt_id: prompt.prompt_id, state_version: prompt.state_version, answer, rationale: reason.trim() };
      return answerPrediction(api, sessionId ?? "", body, keyFor(prompt.prompt_id));
    },
    onSuccess: (result, call) => onAnswered({ ...call, result }),
    onError: (error) => {
      if (isStale(error)) onStale();
    },
  });
}

export function usePredictionRun(input: PredictionRunInput): PredictionRun {
  const api = useAppApi();
  const start = useStart(input);
  const sessionId = start.data?.session_id;
  const [cursor, setCursor] = useState(0);
  const [staleNotice, setStaleNotice] = useState(false);
  const [held, setHeld] = useState<Held | null>(null);
  const [answered, setAnswered] = useState<readonly AnsweredItem[]>([]);
  const promptQuery = useQuery({ ...predictionPromptQuery(api, sessionId ?? "", cursor), enabled: sessionId !== undefined });
  const prompt = promptQuery.data;
  const answer = useAnswer(
    sessionId,
    (item) => setAnswered((list) => appendAnswered(list, item)),
    () => {
      setStaleNotice(true);
      setCursor((value) => value + 1);
    },
  );
  const mine = prompt !== undefined && held?.promptId === prompt.prompt_id ? held : null;
  const draft = prompt === undefined ? null : (mine?.draft ?? emptyDraft(prompt.answer_kind));
  const reason = mine?.reason ?? "";
  const complete = draft !== null && toAnswer(draft) !== null && reasonReady(reason);
  const result = answer.data !== undefined && answer.data.prompt_id === prompt?.prompt_id ? answer.data : undefined;
  const canSubmit = complete && !answer.isPending && result === undefined;
  const { reset } = answer;
  const next = useCallback(() => {
    reset();
    setStaleNotice(false);
    setCursor((value) => value + 1);
  }, [reset]);
  const hold = (patch: Partial<Omit<Held, "promptId">>) => {
    if (prompt !== undefined) setHeld({ promptId: prompt.prompt_id, draft, reason, ...patch });
  };

  return {
    starting: start.isPending,
    sessionId,
    prompt,
    loadingPrompt: promptQuery.isFetching,
    draft,
    setDraft: (value) => hold({ draft: value }),
    reason,
    setReason: (value) => hold({ reason: value }),
    canSubmit,
    submitting: answer.isPending,
    submit: () => {
      if (prompt === undefined || draft === null || !canSubmit) return;
      setStaleNotice(false);
      answer.mutate({ prompt, draft, reason });
    },
    result,
    next,
    answered,
    staleNotice,
    error: start.error ?? promptQuery.error ?? (isStale(answer.error) ? null : answer.error),
  };
}
