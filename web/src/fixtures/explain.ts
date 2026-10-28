/**
 * Synthetic More info and Ask fixtures for the S27 explain tests, the mocked api and the shots
 * (S27 lane D, R3.19, R3.20, O-305 to O-309, O-26, O-264). Typed against the contract, so a shape
 * change is a type error here before it is a wrong picture.
 *
 * The section texts reuse the invented numbers of fixtureFeedback and fixtureInsights (index.ts),
 * the way the api's templates only restate solver-query numbers (O-309, ADR 0004); nothing here is
 * a real solution. The Ask status has one fixture per reason (ok, flag_off, cap_reached, O-305,
 * O-306) and two answers: one validated, one the validator could not check, which carries the
 * api's fixed warning (O-308).
 */
import type { AskResult, AskStatus, MoreInfo } from "../contracts.js";
import { fixtureFeedback } from "./index.js";

/** The api's fixed warning on an answer the validator could not check (O-308). */
export const ASK_UNVALIDATED_WARNING = "Some numbers in this answer could not be checked against the solver data.";
/** The monthly cap in cents (O-5 default). */
export const FIXTURE_ASK_CAP_CENTS = 1500;
/** The first day of the UTC month the spend counts toward. */
export const FIXTURE_ASK_MONTH = "2026-10-01";
const FIXTURE_SPENT_CENTS = 212;
const FIXTURE_ANSWER_COST_CENTS = 2;
const FIXTURE_WARNING_COST_CENTS = 4;

export const fixtureAskStatus: AskStatus = {
  enabled: true,
  available: true,
  reason: "ok",
  cap_cents: FIXTURE_ASK_CAP_CENTS,
  spent_cents: FIXTURE_SPENT_CENTS,
  month: FIXTURE_ASK_MONTH,
};

export const fixtureAskStatusFlagOff: AskStatus = {
  enabled: false,
  available: false,
  reason: "flag_off",
  cap_cents: FIXTURE_ASK_CAP_CENTS,
  spent_cents: 0,
  month: FIXTURE_ASK_MONTH,
};

export const fixtureAskStatusCapReached: AskStatus = {
  enabled: true,
  available: false,
  reason: "cap_reached",
  cap_cents: FIXTURE_ASK_CAP_CENTS,
  spent_cents: FIXTURE_ASK_CAP_CENTS,
  month: FIXTURE_ASK_MONTH,
};

/** The status fixture for each reason, so the mocked api and the tests switch by name. */
export const fixtureAskStatusByReason: Readonly<Record<AskStatus["reason"], AskStatus>> = {
  ok: fixtureAskStatus,
  flag_off: fixtureAskStatusFlagOff,
  cap_reached: fixtureAskStatusCapReached,
};

/** The five template sections in the api's order (O-309): numbers first, strategy before scaffold. */
export function fixtureMoreInfoFor(attemptId: string): MoreInfo {
  return {
    attempt_id: attemptId,
    sections: [
      {
        template: "facts",
        title: "The numbers",
        text: "Raise to 2.5bb is played 80.0% of the time with this hand, for 0.62 bb. Call is played 10.0%, for 0.52 bb.\nThe whole range raises 38.0% and folds 55.0%.\nAJo sits above K9o, the weakest hand that raises half the time or more.",
      },
      {
        template: "range_advantage",
        title: "Range advantage",
        text: "The in-position range has 52.0% mean equity against 48.0% for the out-of-position range.\nNut share: 12.0% in position, 8.0% out of position.",
      },
      {
        template: "hand_role",
        title: "Your hand's role",
        text: "AJo plays as value here. You chose Raise to 2.5bb.",
      },
      {
        template: "position",
        title: "Position",
        text: "You are on the button and act after the folds. Acting last after the flop helps the button realize its equity.",
      },
      {
        template: "blockers",
        title: "Blockers",
        text: "AJo removes 6 of the big blind's combos.\nThe most blocked class is AA.",
      },
    ],
  };
}

export const fixtureMoreInfo: MoreInfo = fixtureMoreInfoFor(fixtureFeedback.attempt_id);

/** A validated answer that only restates fixture numbers and names. */
export function fixtureAskAnswerFor(attemptId: string): AskResult {
  return {
    attempt_id: attemptId,
    text: "Raise to 2.5bb is best here, at 0.62 bb against 0.52 bb for a call.\nAJo blocks AA, so the big blind holds fewer of its strongest hands.",
    validated: true,
    warning: null,
    cached: false,
    cost_cents: FIXTURE_ANSWER_COST_CENTS,
  };
}

/** An answer whose 1.4 bb is in no solver number, so it carries the warning (O-308). */
export function fixtureAskWarningFor(attemptId: string): AskResult {
  return {
    attempt_id: attemptId,
    text: "Raising wins about 1.4 bb more than calling with AJo.",
    validated: false,
    warning: ASK_UNVALIDATED_WARNING,
    cached: false,
    cost_cents: FIXTURE_WARNING_COST_CENTS,
  };
}

export const fixtureAskAnswer: AskResult = fixtureAskAnswerFor(fixtureFeedback.attempt_id);
export const fixtureAskWarning: AskResult = fixtureAskWarningFor(fixtureFeedback.attempt_id);
