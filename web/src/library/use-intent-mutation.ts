/**
 * One write per user intent, with one Idempotency-Key (S28, R3.4, R3.5, O-232; PR #28 review M1).
 *
 * Mechanism: start(input) mints the key when the action starts, not inside the request, and holds
 * it with the input:
 * - while that write is in flight, another start (a double click, a second Enter) sends nothing
 *   and gets the same promise, and `busy` turns true in the same event, so the control is
 *   disabled before the browser can deliver the next click;
 * - when the write fails, the key stays with its input, so retrying the same input reuses it and
 *   the api replays the first answer if the first request did land (O-232); a different input
 *   mints a new key;
 * - when the write succeeds, the key is dropped, so the next action is a new intent.
 * A caller whose inputs change (another spot) remounts the hook's owner, which drops the key.
 * start's promise rejects on failure; send() is the fire-and-forget form for buttons, whose
 * failure the caller reads from `error` instead.
 */
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useLibraryDeps } from "./library-deps.js";

interface Intent<TInput, TResult> {
  readonly input: TInput;
  readonly key: string;
  readonly inFlight: Promise<TResult> | null;
}

export interface IntentMutation<TInput, TResult> {
  start: (input: TInput) => Promise<TResult>;
  send: (input: TInput) => void;
  busy: boolean;
  /** The input of the latest start, or undefined before any. */
  input: TInput | undefined;
  result: TResult | undefined;
  error: unknown;
}

export interface IntentMutationOptions<TInput, TResult> {
  run: (input: TInput, idempotencyKey: string) => Promise<TResult>;
  onSuccess?: (result: TResult, input: TInput) => void | Promise<void>;
  onError?: (error: Error) => void;
}

function sameInput(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function useIntentMutation<TInput, TResult>(options: IntentMutationOptions<TInput, TResult>): IntentMutation<TInput, TResult> {
  const { newKey } = useLibraryDeps();
  const intent = useRef<Intent<TInput, TResult> | null>(null);
  const [busy, setBusy] = useState(false);
  const mutation = useMutation<TResult, Error, { input: TInput; key: string }>({
    mutationFn: ({ input, key }) => options.run(input, key),
    onSuccess: (result, { input }) => options.onSuccess?.(result, input),
    onError: (error) => options.onError?.(error),
  });

  function start(input: TInput): Promise<TResult> {
    const current = intent.current;
    if (current !== null && current.inFlight !== null) return current.inFlight;
    const key = current !== null && sameInput(current.input, input) ? current.key : newKey();
    setBusy(true);
    const inFlight = mutation.mutateAsync({ input, key }).then(
      (result) => {
        intent.current = null;
        setBusy(false);
        return result;
      },
      (error: unknown) => {
        intent.current = { input, key, inFlight: null };
        setBusy(false);
        throw error;
      },
    );
    intent.current = { input, key, inFlight };
    return inFlight;
  }

  return {
    start,
    send: (input) => {
      // The failure is kept in mutation.error and shown by the caller; this only stops the
      // rejected promise from going unhandled.
      start(input).catch(() => undefined);
    },
    busy: busy || mutation.isPending,
    input: mutation.variables?.input,
    result: mutation.data,
    error: mutation.error,
  };
}
