/**
 * What a gap request did, in plain words (S28, R3.4, O-240, ADR 0018). The api answers at once
 * with a status; the screen says what that means and never suggests the request waits for a
 * solve. A failure becomes a fixed message; the problem's detail text is never shown (the S24
 * login precedent).
 */
import { HTTP_STATUS, isApiProblem } from "../api/index.js";
import type { CoverageRequestResult } from "./queries.js";

export function requestResultText(result: CoverageRequestResult): string {
  switch (result.status) {
    case "queued":
      return result.queue_position === null
        ? "Queued for the builder."
        : `Queued for the builder at position ${result.queue_position}.`;
    case "blocked_budget":
      return "Waiting on the storage budget, so it has no queue position yet. The request is recorded.";
    case "recorded":
      return "Recorded for the planner. There is no build job for this spot yet, so it has no queue position.";
    case "covered":
      return "Already in the library. Nothing was queued.";
  }
}

const FAILURE_TEXT: Readonly<Record<number, string>> = {
  [HTTP_STATUS.badRequest]: "That spot is not one the library can hold. Check the flop.",
  [HTTP_STATUS.notFound]: "The catalog holds no such configuration.",
  [HTTP_STATUS.tooManyRequests]: "Too many requests. Try again in a minute.",
  [HTTP_STATUS.badGateway]: "The solver service failed to answer. Try again.",
  [HTTP_STATUS.unavailable]: "The solver service is busy right now. Try again.",
};

export function requestFailureText(error: unknown): string {
  const status = isApiProblem(error) ? error.status : undefined;
  return (status === undefined ? undefined : FAILURE_TEXT[status]) ?? "The request could not be sent. Try again.";
}

/** The contract's flop shape: three cards, rank then suit, for example KhQd4s. */
export const FLOP_PATTERN = /^([2-9TJQKA][cdhs]){3}$/;

/** A typed flop normalized (ranks upper case, suits lower case), or null when it is not one. */
export function normalizeFlop(text: string): string | null {
  const compact = text.replace(/\s+/g, "");
  if (compact.length !== 6) return null;
  const cards = [0, 2, 4].map((at) => `${compact.charAt(at).toUpperCase()}${compact.charAt(at + 1).toLowerCase()}`);
  const flop = cards.join("");
  return FLOP_PATTERN.test(flop) && new Set(cards).size === cards.length ? flop : null;
}
