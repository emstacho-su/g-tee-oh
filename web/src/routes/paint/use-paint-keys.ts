/**
 * One Idempotency-Key per paint submission (S27, R3.17, O-232, PR #29 review M4), as prediction's
 * usePromptKeys does per prompt.
 *
 * Mechanism: a submission is the prompt it answers (session, state version, node) plus the painted
 * map. Its fingerprint is that tuple as JSON with the paint's hands sorted, so the same paint
 * always gives the same fingerprint whatever order the painter listed the hands in. The first
 * submit of a fingerprint mints a key; a later submit of the same fingerprint (Try again after a
 * failed or lost answer, or Submit pressed again) reuses it, so the server replays the stored grade
 * instead of answering 409. A changed paint or the next prompt is a new fingerprint and a new key.
 * The map is replaced, never changed in place, and holds only this run's submissions.
 */
import { useRef } from "react";

import type { RangePaintPrompt } from "../../contracts.js";
import { useTrainerDeps } from "../../trainer/trainer-deps.js";

export type PaintPromptRef = Pick<RangePaintPrompt, "session_id" | "state_version" | "node_key">;

/** The fingerprint of one paint submission: the prompt it answers and the paint, hands sorted. */
export function paintSubmissionFingerprint(prompt: PaintPromptRef, paint: Readonly<Record<string, number>>): string {
  const hands = Object.entries(paint).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return JSON.stringify([prompt.session_id, prompt.state_version, prompt.node_key, hands]);
}

/** A key lookup for paint submissions: the same submission always gets the same key. */
export function usePaintKeys(): (prompt: PaintPromptRef, paint: Readonly<Record<string, number>>) => string {
  const { newKey } = useTrainerDeps();
  const keys = useRef<ReadonlyMap<string, string>>(new Map());
  return (prompt, paint) => {
    const fingerprint = paintSubmissionFingerprint(prompt, paint);
    const known = keys.current.get(fingerprint);
    if (known !== undefined) return known;
    const key = newKey();
    keys.current = new Map([...keys.current, [fingerprint, key]]);
    return key;
  };
}
