/**
 * The decision area under the table (S25, R3.13, R3.11, R3.10, O-282, O-284, O-198, A7 section 4).
 *
 * Mechanism, by machine state: before the decision the roll badge shows the RNG roll alone, never
 * the bands, which are the hand's strategy (O-282). The ActionBar is live in await_action and
 * await_confidence; choosing an action shows "Your choice" and the ConfidenceTap, and choosing
 * another action replaces it. Nothing is revealed and nothing is sent before the tap (R3.11): the
 * feedback panel renders only in the feedback state, which follows the decision response. Spot
 * mode then pauses on the reveal until Next (O-284), with the bar disabled. The feedback panel
 * gets the range view and the threshold card of the decided node, and the roller when the session
 * has RNG on (lane C's components, O-281, O-282). All action indexes are NodeAction.index (O-198).
 * In street and full-hand modes a reveal that does not pause (O-314) shows the result chip instead
 * of the panel while the screen continues by itself; Next stays available (S26).
 */
import {
  ActionBar,
  ConfidenceTap,
  FeedbackPanel,
  FeedbackRangeView,
  FeedbackRoller,
  FeedbackThreshold,
  RollBadge,
  actionAccessibleName,
  actionButtonLabel,
  type ConfidenceChoice,
} from "../../components/trainer/index.js";
import { Button, LoadingNote } from "../../components/ui/index.js";
import type { Grouping, TrainerPrompt } from "../../contracts.js";
import { useHotkey } from "../../hotkeys/index.js";
import { actionOfIndex } from "../../poker/action-index.js";
import { autoContinueDelay, type SpotState } from "../../trainer/spot-machine.js";
import { problemMessage } from "../../trainer/spot-problem.js";
import { NEXT_HAND_KEY, SESSION_SCOPE, SESSION_TEXT } from "./labels.js";
import { ResultChip } from "./ResultChip.js";

export interface DecisionAreaProps {
  state: SpotState;
  prompt: TrainerPrompt;
  grouping: Grouping;
  /** False while a dialog is open over the screen: buttons and their hotkeys pause. */
  interactive: boolean;
  onChoose: (actionIndex: number) => void;
  onConfidence: (confidence: ConfidenceChoice) => void;
  onNext: () => void;
  onExplain: () => void;
}

const BEFORE_DECISION: ReadonlySet<SpotState["kind"]> = new Set(["await_action", "await_confidence", "submitting", "error"]);

function ChoiceAndTap({ state, prompt, grouping, interactive, onConfidence }: DecisionAreaProps) {
  if (state.kind !== "await_confidence") return null;
  const chosen = actionOfIndex(prompt.buttons, state.actionIndex);
  const name = chosen === undefined ? String(state.actionIndex) : actionAccessibleName(actionButtonLabel(chosen, grouping, prompt.street));
  return (
    <div className="flex flex-col gap-2">
      <p aria-live="polite" className="font-medium">{`Your choice: ${name}`}</p>
      <ConfidenceTap onChoose={onConfidence} disabled={!interactive} />
    </div>
  );
}

function Feedback({ state, prompt, interactive, onNext, onExplain }: DecisionAreaProps) {
  const enabled = state.kind === "feedback" && interactive;
  useHotkey({ key: NEXT_HAND_KEY, description: SESSION_TEXT.nextHand, scope: SESSION_SCOPE, handler: onNext }, enabled);
  if (state.kind !== "feedback") return null;
  const { feedback, decision, context } = state;
  // A reveal that does not pause shows the short result chip and continues by itself (S26, O-314).
  const continuesByItself = autoContinueDelay(state) !== null;
  return (
    <div className="flex flex-col gap-3">
      {continuesByItself ? (
        <ResultChip feedback={feedback} />
      ) : (
        <FeedbackPanel
          feedback={feedback}
          actions={prompt.buttons}
          chosenIndex={decision.actionIndex}
          rangeView={<FeedbackRangeView feedback={feedback} />}
          thresholdCard={<FeedbackThreshold feedback={feedback} />}
          roller={context.rng ? <FeedbackRoller feedback={feedback} actions={prompt.buttons} onExplain={onExplain} /> : undefined}
        />
      )}
      <Button variant="primary" size="lg" aria-keyshortcuts={NEXT_HAND_KEY} disabled={!interactive} onClick={onNext} className="self-start">
        <kbd aria-hidden="true" className="font-mono text-xs">
          {NEXT_HAND_KEY}
        </kbd>
        {SESSION_TEXT.nextHand}
      </Button>
    </div>
  );
}

export function DecisionArea(props: DecisionAreaProps) {
  const { state, prompt, grouping, interactive, onChoose, onExplain } = props;
  const choosing = state.kind === "await_action" || state.kind === "await_confidence";
  const roll = BEFORE_DECISION.has(state.kind) ? prompt.rng_roll : null;
  return (
    <div className="flex flex-col gap-3" data-testid="decision-area">
      {state.kind === "await_action" && state.notice !== null ? <p role="status">{problemMessage({ kind: state.notice, status: null })}</p> : null}
      {roll === null ? null : <RollBadge roll={roll} onExplain={onExplain} />}
      <ActionBar actions={prompt.buttons} grouping={grouping} street={prompt.street} disabled={!choosing || !interactive} onAction={onChoose} />
      <ChoiceAndTap {...props} />
      {state.kind === "submitting" ? <LoadingNote text={SESSION_TEXT.grading} /> : null}
      <Feedback {...props} />
    </div>
  );
}
