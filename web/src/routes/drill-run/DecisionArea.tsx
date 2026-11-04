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
 * followed-the-roll mark (FeedbackRoller, O-281, O-344, O-371), the insights and More info as the
 * inline Explanation section (S38, O-388), each in a section that expands and collapses, with the
 * prompt's worked-example flag and the session's remembered choices (O-387). All action indexes are
 * NodeAction.index (O-198). Choosing an action, and every new prompt, moves the focus off the
 * action bar onto the area itself (tabindex -1, a group named by the prompt), and a reveal moves
 * it on to the Next hand button, so a clicked button never takes a later Enter or Space and the
 * focus always sits on a named target with the app's focus ring (S46, PR #45 review rounds 3 and
 * 4, findings 1 and f). In street and full-hand modes a reveal that does not pause (O-314)
 * shows the result chip instead of the panel while the screen continues by itself; Next stays
 * available (S26). Before the decision, a prompt that names a panel revealing the answer, or a
 * worked example, shows the reveal notice above the action bar (RevealNotice, S46, R3.33); on the
 * reveal the prompt's visible panels open their feedback sections (sectionsFromPanels).
 */
import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";

import { ActionBar, FeedbackPanel, RngRoller, sectionsFromPanels, type FeedbackSectionsControl } from "../../components/trainer/index.js";
import { ExplainControls } from "../../components/explain/ExplainControls.js";
import { Button, LoadingNote } from "../../components/ui/index.js";
import type { Grouping, TrainerPrompt } from "../../contracts.js";
import { useHotkey } from "../../hotkeys/index.js";
import { replayKey } from "../../trainer/action-replay.js";
import { atSessionLimit } from "../../trainer/session-length.js";
import { autoContinueDelay, type SpotState } from "../../trainer/spot-machine.js";
import { problemMessage } from "../../trainer/spot-problem.js";
import { unratedReason } from "../../trainer/unrated-reason.js";
import { feedbackSlots } from "./feedback-slots.js";
import { NEXT_HAND_ENTER_KEY, NEXT_HAND_KEY, SESSION_SCOPE, SESSION_TEXT, decisionAreaName } from "./labels.js";
import { ResultChip } from "./ResultChip.js";
import { RevealNotice } from "./RevealNotice.js";

export interface DecisionAreaProps {
  state: SpotState;
  prompt: TrainerPrompt;
  grouping: Grouping;
  /** False while a dialog is open over the screen: buttons and their hotkeys pause. */
  interactive: boolean;
  /**
   * True while the table replays the line before the decision (S38, O-381): the action bar waits.
   * A click on the table or an action key finishes the replay at once (useActionReplay).
   */
  replaying?: boolean;
  /** The table (SpotTable), drawn above the action bar (S38 layout). */
  table?: ReactNode;
  /** Choosing an action submits the decision (O-345). */
  onChoose: (actionIndex: number) => void;
  onNext: () => void;
  onExplain: () => void;
  /** Ask's dialog opened or closed (S27, S38 O-388): the screen pauses its hotkeys while it is open. */
  onExplainDialog?: (open: boolean) => void;
  /**
   * The session's remembered feedback sections (useFeedbackSections, O-387), held by the screen
   * because this area unmounts between hands; without it each panel starts from the defaults.
   */
  feedbackSections?: FeedbackSectionsControl;
}

/** The Next hand button, the focus target once a reveal mounts (PR #45 review round 4, finding f). */
const NEXT_HAND_SELECTOR = "[data-next-hand]";

/** Whether the focus is the page's or the area's own, so moving it takes nothing from the user. */
function focusIsOurs(area: HTMLElement | null): boolean {
  const active = document.activeElement;
  return area !== null && (active === null || active === document.body || area.contains(active));
}

/** The states in which the hidden roll scale stands above the action bar. */
const BEFORE_DECISION: ReadonlySet<SpotState["kind"]> = new Set(["await_action", "submitting", "error"]);

/** The chosen action's index once a decision is made, so the bar marks it (S46, critic G10). */
function chosenIndexOf(state: SpotState): number | null {
  switch (state.kind) {
    case "submitting":
    case "feedback":
      return state.decision.actionIndex;
    case "error":
      return state.decision?.actionIndex ?? null;
    default:
      return null;
  }
}

function Feedback({ state, prompt, interactive, onNext, onExplain, onExplainDialog, feedbackSections }: DecisionAreaProps) {
  const enabled = state.kind === "feedback" && interactive;
  // On the last planned hand's reveal Next finishes the session (S46, R3.31).
  const nextLabel = atSessionLimit(state) ? SESSION_TEXT.finishSession : SESSION_TEXT.nextHand;
  // N and Enter both go on (S46, R3.30, design rule 9).
  useHotkey({ key: NEXT_HAND_KEY, description: nextLabel, scope: SESSION_SCOPE, handler: onNext }, enabled);
  useHotkey({ key: NEXT_HAND_ENTER_KEY, description: nextLabel, scope: SESSION_SCOPE, handler: onNext }, enabled);
  if (state.kind !== "feedback") return null;
  const { feedback, decision, context } = state;
  // A reveal that does not pause shows the short result chip and continues by itself (S26, O-314).
  const continuesByItself = autoContinueDelay(state) !== null;
  // The same section bodies the session history reopens the decision with (S46, R3.32). The
  // grouping is the session's, never a setting changed since (PR #33 review round 1).
  const slots = feedbackSlots({
    feedback,
    actions: prompt.buttons,
    chosenIndex: decision.actionIndex,
    grouping: context.session.grouping,
    street: prompt.street,
    rng: context.rng,
    onExplain,
  });
  // Next hand stands above the panel, so it is reached without scrolling past the open sections
  // (S46, critic round 3 R10); the row inside the panel holds Ask.
  return (
    <div className="flex flex-col gap-3">
      <Button data-next-hand="" variant="primary" size="lg" aria-keyshortcuts={`${NEXT_HAND_KEY} ${NEXT_HAND_ENTER_KEY}`} disabled={!interactive} onClick={onNext} className="self-start">
        <kbd aria-hidden="true" className="font-mono text-xs">
          {NEXT_HAND_KEY}
        </kbd>
        {nextLabel}
      </Button>
      {continuesByItself ? (
        <ResultChip feedback={feedback} actions={prompt.buttons} chosenIndex={decision.actionIndex} />
      ) : (
        <FeedbackPanel
          feedback={feedback}
          actions={prompt.buttons}
          chosenIndex={decision.actionIndex}
          unratedReason={unratedReason(feedback, prompt, context.session)}
          {...slots}
          explain={<ExplainControls feedback={feedback} {...(onExplainDialog === undefined ? {} : { onDialogOpenChange: onExplainDialog })} />}
          workedExample={prompt.worked_example}
          defaultOpen={sectionsFromPanels(prompt.visible_panels)}
          {...(feedbackSections === undefined ? {} : { sections: feedbackSections })}
        />
      )}
    </div>
  );
}

/**
 * Layout (S38, rows 6 and 31): one column at every width, the table first, then the roll scale, the
 * action bar and the feedback, whose panel keeps its own tight width (at most 28rem). A side column
 * for the feedback was tried and dropped: the app shell's main column is about 980 px even at
 * 1440, so a 28rem column beside the table would leave the table under the 600 px it needs to
 * stay landscape (O-380).
 */
export function DecisionArea(props: DecisionAreaProps) {
  const { state, prompt, grouping, interactive, replaying = false, table, onChoose, onExplain } = props;
  const choosing = state.kind === "await_action" && !replaying;
  const roll = BEFORE_DECISION.has(state.kind) ? prompt.rng_roll : null;
  const areaRef = useRef<HTMLDivElement>(null);
  const focusOffBar = useCallback(() => areaRef.current?.focus({ preventScroll: true }), []);
  // A new prompt can render into the same buttons (same NodeAction.index), enabled again; a
  // button that kept the focus would then take the next Enter or Space (PR #45 review round 3, 1).
  const promptKey = replayKey(prompt);
  useLayoutEffect(() => {
    if (focusIsOurs(areaRef.current)) focusOffBar();
  }, [promptKey, focusOffBar]);
  // Once the reveal mounts, the focus goes on to Next hand, a named button whose own Enter goes on
  // (PR #45 review round 4, finding f), unless the user has put it somewhere else.
  const revealed = state.kind === "feedback";
  useLayoutEffect(() => {
    if (!revealed || !focusIsOurs(areaRef.current)) return;
    areaRef.current?.querySelector<HTMLElement>(NEXT_HAND_SELECTOR)?.focus({ preventScroll: true });
  }, [revealed, promptKey]);
  const choose = (actionIndex: number) => {
    focusOffBar();
    onChoose(actionIndex);
  };
  return (
    // tabindex -1: a focus target for the code above, never a tab stop. Named by the prompt, and it
    // keeps the app's focus ring (PR #45 review round 4, finding f).
    <div
      ref={areaRef}
      role="group"
      aria-label={decisionAreaName(prompt)}
      tabIndex={-1}
      className="flex min-w-0 flex-col gap-3 rounded-xl"
      data-testid="decision-area"
    >
      {table}
      {state.kind === "await_action" && state.notice !== null ? <p role="status">{problemMessage({ kind: state.notice, status: null })}</p> : null}
      {BEFORE_DECISION.has(state.kind) ? <RevealNotice key={promptKey} prompt={prompt} /> : null}
      {roll === null ? null : <RngRoller hidden roll={roll} onExplain={onExplain} />}
      <ActionBar
        actions={prompt.buttons}
        grouping={grouping}
        street={prompt.street}
        disabled={!choosing || !interactive}
        chosenIndex={chosenIndexOf(state)}
        onAction={choose}
      />
      {state.kind === "submitting" ? <LoadingNote text={SESSION_TEXT.grading} /> : null}
      <Feedback {...props} />
    </div>
  );
}
