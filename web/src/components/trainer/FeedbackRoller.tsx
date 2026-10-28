/**
 * The RNG (random number generator) roller after the reveal (S25, R3.10, O-282, O-213, O-198).
 *
 * Mechanism: once the decision is graded, the bands are no longer a secret, so this renders the
 * RngRoller with the hand's frequencies from the feedback (freq_by_action) and the roll the
 * grade used (rng_roll); without a roll it renders nothing. Next to the strip it labels the
 * roll-selected action Best in text ("Best: Raise to 2.5bb, selected by roll 37"). The pick comes
 * from rollSelectedAction in packages/learning through toGradeActions, the same entry grade()
 * used on the server (O-213), and is converted from a record position to NodeAction.index with
 * indexAtPosition (O-198). Because both sides share that entry, the pick should always be one of
 * feedback.best_action_indexes; if it is not, an alert states the disagreement instead of
 * hiding it, so a drift between the roller and the grade is visible. Input the learning package
 * rejects is left to RngRoller's own alert, and no Best label is added then.
 */
import { rollSelectedAction } from "@g-tee-oh/learning";

import type { DecisionFeedback, NodeAction } from "../../contracts.js";
import { actionOfIndex, indexAtPosition } from "../../poker/action-index.js";
import { toGradeActions } from "../../poker/grade-actions.js";
import { RngRoller } from "./RngRoller.js";

export interface FeedbackRollerProps {
  feedback: DecisionFeedback;
  actions: readonly NodeAction[];
  onExplain: () => void;
}

/** The roll's pick as a NodeAction, or null when the learning package rejects the input. */
function rollPick(actions: readonly NodeAction[], freqByAction: readonly number[], roll: number): NodeAction | null {
  try {
    const position = rollSelectedAction(freqByAction, toGradeActions(actions), roll);
    return actionOfIndex(actions, indexAtPosition(actions, position)) ?? null;
  } catch (error: unknown) {
    // RngRoller renders the same RangeError as its alert; anything else is a bug.
    if (error instanceof RangeError) return null;
    throw error;
  }
}

function bestLabels(actions: readonly NodeAction[], indexes: readonly number[]): string {
  return indexes.map((index) => actionOfIndex(actions, index)?.label ?? `action ${index}`).join(", ");
}

interface PickNoteProps {
  pick: NodeAction;
  roll: number;
  feedback: DecisionFeedback;
  actions: readonly NodeAction[];
}

function PickNote({ pick, roll, feedback, actions }: PickNoteProps) {
  if (!feedback.best_action_indexes.includes(pick.index)) {
    return (
      <p role="alert" className="text-danger">
        {`Roll ${roll} selects ${pick.label}, but the grade marks ${bestLabels(actions, feedback.best_action_indexes)} as best. The roller and the grade should agree, so this is a bug worth reporting.`}
      </p>
    );
  }
  return (
    <p data-testid="rng-best" data-action-index={pick.index} className="font-medium text-success">
      <span aria-hidden="true" className="mr-1 font-mono">
        {"★"}
      </span>
      {`Best: ${pick.label}, selected by roll ${roll}`}
    </p>
  );
}

export function FeedbackRoller({ feedback, actions, onExplain }: FeedbackRollerProps) {
  const roll = feedback.rng_roll;
  if (roll === null) return null;
  const pick = rollPick(actions, feedback.freq_by_action, roll);
  return (
    <div data-testid="feedback-roller" className="flex flex-col gap-2">
      <RngRoller actions={actions} freqByAction={feedback.freq_by_action} roll={roll} onExplain={onExplain} />
      {pick === null ? null : <PickNote pick={pick} roll={roll} feedback={feedback} actions={actions} />}
    </div>
  );
}
