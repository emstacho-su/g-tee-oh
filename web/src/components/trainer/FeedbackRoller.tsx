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
 * reads it with learning's followsRoll over the prompt's buttons, the session's grouping and the
 * street (the one entry grade() uses, O-213), with the chosen NodeAction.index converted to its
 * record position (O-198). If the two disagree an alert says so instead of either mark, so a drift
 * is visible. An attempt stored before the mark existed has followed_roll null and shows the
 * scale's own reading. Input the learning package rejects is left to RngRoller's own alert, and no
 * mark is added then.
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

function FollowMark({ reading, roll, chosen }: FollowMarkProps) {
  const where = `roll ${roll} fell on ${reading.fellOn.label}`;
  const text = reading.followed
    ? `${FOLLOW_TEXT.followed}: ${where}`
    : `${FOLLOW_TEXT.notFollowed}: ${where}${chosen === undefined ? "" : `, you chose ${chosen.label}`}`;
  return (
    <p data-testid="rng-follow" data-followed={String(reading.followed)} className="flex items-center gap-2 font-medium">
      <span aria-hidden="true" className="font-mono">
        {reading.followed ? "✓" : "✗"}
      </span>
      <span>{text}</span>
    </p>
  );
}

export function FeedbackRoller(props: FeedbackRollerProps) {
  const { feedback, actions, chosenIndex, onExplain } = props;
  const roll = feedback.rng_roll;
  if (roll === null) return null;
  const reading = readRoll(props, roll);
  const disagrees = reading !== null && feedback.followed_roll !== null && feedback.followed_roll !== reading.followed;
  return (
    <div data-testid="feedback-roller" className="flex flex-col gap-2">
      <RngRoller actions={actions} freqByAction={feedback.freq_by_action} roll={roll} onExplain={onExplain} />
      {disagrees ? (
        <p role="alert" className="text-danger">
          {FOLLOW_TEXT.disagree}
        </p>
      ) : null}
      {reading === null || disagrees ? null : <FollowMark reading={reading} roll={roll} chosen={actionOfIndex(actions, chosenIndex)} />}
    </div>
  );
}
