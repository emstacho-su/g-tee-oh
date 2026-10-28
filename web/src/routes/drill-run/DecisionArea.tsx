/**
 * The decision area under the table (S25, S37, R3.13, R3.10, O-282, O-284, O-344, O-345, O-198,
 * ADR 0024, A7 section 4).
 *
 * Mechanism, by machine state: before the decision, in Mixed-frequency mode, the roll scale shows
 * the roll on 1 to 100 with no bands, which are the hand's strategy (ADR 0024 rule 3). The
 * ActionBar is live in await_action, and choosing an action submits it at once: the confidence
 * tap was retired (O-345), so nothing is revealed and nothing is sent before the choice, and the
 * choice is final. The feedback panel renders only in the feedback state, which follows the
 * decision response. Spot mode then pauses on the reveal until Next (O-284), with the bar
 * disabled. The feedback panel gets the range view and the threshold card of the decided node,
 * and, when the session has the mode on, the same roll scale with its bands revealed and the
 * followed-the-roll mark (FeedbackRoller, O-281, O-344, O-371). All action indexes are
 * NodeAction.index (O-198). In street and full-hand modes a reveal that does not pause (O-314)
 * shows the result chip instead of the panel while the screen continues by itself; Next stays
 * available (S26).
 */
import {
  ActionBar,
  FeedbackPanel,
  FeedbackRangeView,
  FeedbackRoller,
  FeedbackThreshold,
  RngRoller,
} from "../../components/trainer/index.js";
import { ExplainControls } from "../../components/explain/ExplainControls.js";
import { FeedbackInsights } from "../../components/insights/FeedbackInsights.js";
import { Button, LoadingNote } from "../../components/ui/index.js";
import type { Grouping, TrainerPrompt } from "../../contracts.js";
import { useHotkey } from "../../hotkeys/index.js";
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
  /** Choosing an action submits the decision (O-345). */
  onChoose: (actionIndex: number) => void;
  onNext: () => void;
  onExplain: () => void;
  /** More info or Ask opened or closed (S27): the screen pauses its hotkeys while one is open. */
  onExplainDialog?: (open: boolean) => void;
}

/** The states in which the hidden roll scale stands above the action bar. */
const BEFORE_DECISION: ReadonlySet<SpotState["kind"]> = new Set(["await_action", "submitting", "error"]);

function Feedback({ state, prompt, interactive, onNext, onExplain, onExplainDialog }: DecisionAreaProps) {
  const enabled = state.kind === "feedback" && interactive;
  useHotkey({ key: NEXT_HAND_KEY, description: SESSION_TEXT.nextHand, scope: SESSION_SCOPE, handler: onNext }, enabled);
  if (state.kind !== "feedback") return null;
  const { feedback, decision, context } = state;
  // A reveal that does not pause shows the short result chip and continues by itself (S26, O-314).
  const continuesByItself = autoContinueDelay(state) !== null;
  const roller = context.rng ? (
    <FeedbackRoller
      feedback={feedback}
      actions={prompt.buttons}
      chosenIndex={decision.actionIndex}
      // The grouping the session was started and graded with, never a setting changed since (PR #33 review round 1).
      grouping={context.session.grouping}
      street={prompt.street}
      onExplain={onExplain}
    />
  ) : undefined;
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
          roller={roller}
          insights={<FeedbackInsights feedback={feedback} />}
          explain={<ExplainControls feedback={feedback} {...(onExplainDialog === undefined ? {} : { onDialogOpenChange: onExplainDialog })} />}
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
  const choosing = state.kind === "await_action";
  const roll = BEFORE_DECISION.has(state.kind) ? prompt.rng_roll : null;
  return (
    <div className="flex flex-col gap-3" data-testid="decision-area">
      {state.kind === "await_action" && state.notice !== null ? <p role="status">{problemMessage({ kind: state.notice, status: null })}</p> : null}
      {roll === null ? null : <RngRoller hidden roll={roll} onExplain={onExplain} />}
      <ActionBar actions={prompt.buttons} grouping={grouping} street={prompt.street} disabled={!choosing || !interactive} onAction={onChoose} />
      {state.kind === "submitting" ? <LoadingNote text={SESSION_TEXT.grading} /> : null}
      <Feedback {...props} />
    </div>
  );
}
