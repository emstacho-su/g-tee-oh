/**
 * One prediction session on the /predict screen (S27 lane A, R3.16, O-232, O-302).
 *
 * Mechanism: on mount the hook starts a prediction session for the drill (POST /sessions with mode
 * prediction, the optional seed and one Idempotency-Key kept for the life of the screen, so a
 * repeated start replays instead of opening a second session). The prompt is read through
 * predictionPromptQuery at a local cursor; the answer being composed is a draft held per prompt
 * id (draft.ts). Submit posts the answer with the prompt's id and state_version and an
 * Idempotency-Key kept per prompt, so a retry of the same answer is recorded once. The result
 * stays on screen until Next, which moves the cursor so the next prompt is read. A 409 stale-state
 * answer (the session moved on elsewhere) moves the cursor too, so the current prompt is read
 * again, and a notice says so; every other failure is kept for the screen to show as fixed text.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { HTTP_STATUS, isApiProblem } from "../api/index.js";
import { useAppApi } from "../auth/index.js";
import type { PredictionPrompt, PredictionResult } from "../contracts.js";
import { useTrainerDeps } from "../trainer/trainer-deps.js";
import { answerPrediction, predictionPromptQuery, startPredictionSession } from "./api.js";
import { emptyDraft, toAnswer, type AnswerDraft } from "./draft.js";
import type { PredictionAnswerBody } from "./types.js";

const STALE_SLUG = "stale-state";

export interface PredictionRunInput {
  drillId: string;
  seed: string | undefined;
}

export interface PredictionRun {
  starting: boolean;
  prompt: PredictionPrompt | undefined;
  loadingPrompt: boolean;
  draft: AnswerDraft | null;
  setDraft: (draft: AnswerDraft) => void;
  canSubmit: boolean;
  submitting: boolean;
  submit: () => void;
  result: PredictionResult | undefined;
  next: () => void;
  staleNotice: boolean;
  error: unknown;
}

interface HeldDraft {
  promptId: string;
  draft: AnswerDraft;
}

function isStale(error: unknown): boolean {
  return isApiProblem(error) && error.status === HTTP_STATUS.conflict && error.slug === STALE_SLUG;
}

/** Starts the session once per mounted screen; the key makes a repeated start a replay (O-232). */
function useStart(input: PredictionRunInput) {
  const api = useAppApi();
  const { newKey } = useTrainerDeps();
  const [key] = useState(newKey);
  const start = useMutation({ mutationFn: () => startPredictionSession(api, { drillId: input.drillId, seed: input.seed, key }) });
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

/** The answer POST; a stale-state failure calls onStale so the current prompt is read again. */
function useAnswer(sessionId: string | undefined, onStale: () => void) {
  const api = useAppApi();
  const keyFor = usePromptKeys();
  return useMutation({
    mutationFn: (body: PredictionAnswerBody) => answerPrediction(api, sessionId ?? "", body, keyFor(body.prompt_id)),
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
  const [held, setHeld] = useState<HeldDraft | null>(null);
  const promptQuery = useQuery({ ...predictionPromptQuery(api, sessionId ?? "", cursor), enabled: sessionId !== undefined });
  const prompt = promptQuery.data;
  const answer = useAnswer(sessionId, () => {
    setStaleNotice(true);
    setCursor((value) => value + 1);
  });
  const draft = prompt === undefined ? null : held?.promptId === prompt.prompt_id ? held.draft : emptyDraft(prompt.answer_kind);
  const complete = draft === null ? null : toAnswer(draft);
  const result = answer.data !== undefined && answer.data.prompt_id === prompt?.prompt_id ? answer.data : undefined;
  const { reset } = answer;
  const next = useCallback(() => {
    reset();
    setStaleNotice(false);
    setCursor((value) => value + 1);
  }, [reset]);

  return {
    starting: start.isPending,
    prompt,
    loadingPrompt: promptQuery.isFetching,
    draft,
    setDraft: (value) => {
      if (prompt !== undefined) setHeld({ promptId: prompt.prompt_id, draft: value });
    },
    canSubmit: complete !== null && !answer.isPending && result === undefined,
    submitting: answer.isPending,
    submit: () => {
      if (prompt === undefined || complete === null || answer.isPending || result !== undefined) return;
      setStaleNotice(false);
      answer.mutate({ prompt_id: prompt.prompt_id, state_version: prompt.state_version, answer: complete });
    },
    result,
    next,
    staleNotice,
    error: start.error ?? promptQuery.error ?? (isStale(answer.error) ? null : answer.error),
  };
}
