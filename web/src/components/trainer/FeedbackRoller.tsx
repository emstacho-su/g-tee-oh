/**
 * The roll scale after the reveal, with the followed-the-roll mark (S25, S37, R3.10, ADR 0024,
 * O-213, O-344, O-371, O-198).
 *
 * Mechanism: once the decision is graded the bands are no longer a secret, so this renders the same
 * RngRoller, revealed, with the hand's frequencies from the feedback (freq_by_action) and the roll
 * the grade used (rng_roll); without a roll it renders nothing. Under the scale it shows the mark,
 * separate from the grade label and never named Best (ADR 0024 rule 2): "✓ You followed the roll:
 * roll 37 fell on Raise to 2.5bb" or "✗ You did not follow the roll: roll 37 fell on Raise to
 * 2.5bb, you chose Call", the icon hidden from screen readers and the words carrying the meaning,
 * so color is never the only signal.
 *
 * The mark is the grade's: feedback.followed_roll, stored with the attempt (O-371). The scale also
 * reads it with learning's followsRoll over the prompt's buttons, the grouping the session was
 * started and graded with and the street (the one entry grade() uses, O-213), with the chosen
 * NodeAction.index converted to its record position (O-198). If both exist and disagree an alert
 * says so instead of either mark, so a drift is visible. A stored mark counts only when it is a
 * boolean: an attempt stored before the mark existed (null) or a body without the field (an older
 * or replayed response) shows the scale's own reading. When the scale cannot read the roll itself
 * (input the learning package rejects, left to RngRoller's own alert, or a chosen index it cannot
 * place), the stored mark still shows, in words only. With neither, no mark is guessed (PR #33
 * review round 1).
 */
import { followsRoll, rollSelectedAction } from "@g-tee-oh/learning";

import type { DecisionFeedback, Grouping, NodeAction, Street } from "../../contracts.js";
import { actionOfIndex, positionOfIndex } from "../../poker/action-index.js";
import { toGradeActions } from "../../poker/grade-actions.js";
import { RngRoller } from "./RngRoller.js";

export interface FeedbackRollerProps {
  feedback: DecisionFeedback;
  actions: readonly NodeAction[];
  /** NodeAction.index of the chosen action (O-198). */
  chosenIndex: number;
  grouping: Grouping;
  street: Street;
  onExplain: () => void;
}

export const FOLLOW_TEXT = {
  followed: "You followed the roll",
  notFollowed: "You did not follow the roll",
  disagree:
    "The roll scale and the grade disagree on whether you followed the roll. They should agree, so this is a bug worth reporting.",
} as const;

interface Reading {
  readonly followed: boolean;
  /** The action whose band holds the roll. */
  readonly fellOn: NodeAction;
}

/** The grade's stored mark, or null when the body has none (null, or the field absent). */
function storedMark(feedback: DecisionFeedback): boolean | null {
  const stored: unknown = feedback.followed_roll;
  return typeof stored === "boolean" ? stored : null;
}

/** The scale's own reading, or null when the learning package rejects the input. */
function readRoll(props: FeedbackRollerProps, roll: number): Reading | null {
  const { feedback, actions, chosenIndex, grouping, street } = props;
  const position = positionOfIndex(actions, chosenIndex);
  if (position === undefined) return null;
  try {
    const gradeActions = toGradeActions(actions);
    const followed = followsRoll({ freqByAction: feedback.freq_by_action, actions: gradeActions, grouping, street, roll, actionIndex: position });
    const fellOn = actions[rollSelectedAction(feedback.freq_by_action, gradeActions, roll)];
    return fellOn === undefined ? null : { followed, fellOn };
  } catch (error: unknown) {
    // RngRoller renders the same RangeError as its alert; anything else is a bug.
    if (error instanceof RangeError) return null;
    throw error;
  }
}

interface FollowMarkProps {
  reading: Reading;
  roll: number;
  chosen: NodeAction | undefined;
}

function markText({ reading, roll, chosen }: FollowMarkProps): string {
  const where = `roll ${roll} fell on ${reading.fellOn.label}`;
  return reading.followed
    ? `${FOLLOW_TEXT.followed}: ${where}`
    : `${FOLLOW_TEXT.notFollowed}: ${where}${chosen === undefined ? "" : `, you chose ${chosen.label}`}`;
}

/** The mark: a check or a cross for sighted users and the words for everyone, never color alone. */
function MarkLine({ followed, text }: { followed: boolean; text: string }) {
  return (
    <p data-testid="rng-follow" data-followed={String(followed)} className="flex items-center gap-2 font-medium">
      <span aria-hidden="true" className="font-mono">
        {followed ? "✓" : "✗"}
      </span>
      <span>{text}</span>
    </p>
  );
}

/** The grade's stored mark in words, when the scale cannot read the roll itself. */
function storedMarkText(followed: boolean, roll: number): string {
  return `${followed ? FOLLOW_TEXT.followed : FOLLOW_TEXT.notFollowed} (roll ${roll})`;
}

export function FeedbackRoller(props: FeedbackRollerProps) {
  const { feedback, actions, chosenIndex, onExplain } = props;
  const roll = feedback.rng_roll;
  if (roll === null) return null;
  const reading = readRoll(props, roll);
  const stored = storedMark(feedback);
  const disagrees = reading !== null && stored !== null && stored !== reading.followed;
  return (
    <div data-testid="feedback-roller" className="flex flex-col gap-2">
      <RngRoller actions={actions} freqByAction={feedback.freq_by_action} roll={roll} onExplain={onExplain} />
      {disagrees ? (
        <p role="alert" className="text-danger">
          {FOLLOW_TEXT.disagree}
        </p>
      ) : null}
      {disagrees ? null : reading !== null ? (
        <MarkLine followed={reading.followed} text={markText({ reading, roll, chosen: actionOfIndex(actions, chosenIndex) })} />
      ) : stored !== null ? (
        <MarkLine followed={stored} text={storedMarkText(stored, roll)} />
      ) : null}
    </div>
  );
}
