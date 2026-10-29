/**
 * The running session of /train (S32, S37, R4.10, R3.13, O-272, O-284, O-285, O-325, O-328, O-345): the S25
 * and S26 trainer screen in spot mode, reused part for part. Above the table the BlockBanner says
 * which block the hand belongs to (or the holdout round's progress); then SpotTable, and
 * DecisionArea with the action bar, whose choice submits the decision (the confidence tap was
 * retired, O-345), the FeedbackPanel and Next; then End session, which opens the confirm dialog the page owns.
 * Automated and holdout sessions stop after every action, so no run settings go to the machine
 * and every reveal waits for Next.
 *
 * TrainAlert names a failure with /train's own sentence (train-text.ts trainProblemMessage) and
 * offers Try again only for a transient failure in a running session, as the drill run does; on
 * the start panel Start is the retry.
 */
import { DecisionArea } from "../drill-run/DecisionArea.js";
import { END_SESSION_BINDING, SESSION_TEXT } from "../drill-run/labels.js";
import { SessionHandCounter } from "../drill-run/RunProgress.js";
import { SpotTable } from "../drill-run/SpotTable.js";
import { Button, LoadingNote } from "../../components/ui/index.js";
import type { Grouping, TrainerPrompt } from "../../contracts.js";
import { displayBinding } from "../../hotkeys/index.js";
import type { TrackKey } from "../../progress/types.js";
import { useFeedbackSections } from "../../components/trainer/index.js";
import { canEnd, type SpotState } from "../../trainer/spot-machine.js";
import type { SpotProblem } from "../../trainer/spot-problem.js";
import type { SpotSession } from "../../trainer/use-spot-session.js";
import type { BlockView, HoldoutView } from "./block-progress.js";
import { BlockBanner } from "./BlockBanner.js";
import { trainProblemMessage, TRAIN_TEXT, type TrainMode } from "./train-text.js";

/** The prompt on screen in a state, if any. */
export function promptOf(state: SpotState): TrainerPrompt | null {
  switch (state.kind) {
    case "await_action":
    case "submitting":
    case "feedback":
    case "error":
      return state.prompt;
    default:
      return null;
  }
}

/** The start panel shows before a session and after a failed start. */
export function onStartPanel(state: SpotState): boolean {
  return state.kind === "idle" || state.kind === "starting" || (state.kind === "error" && state.context === null);
}

export interface TrainAlertProps {
  mode: TrainMode;
  problem: SpotProblem;
  /** True while the start panel shows, so a start problem gets its own sentence. */
  onStart: boolean;
  canRetry: boolean;
  onRetry: () => void;
}

export function TrainAlert({ mode, problem, onStart, canRetry, onRetry }: TrainAlertProps) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-danger px-3 py-2">
      <p className="text-danger">{trainProblemMessage(mode, problem, onStart)}</p>
      {canRetry ? <Button onClick={onRetry}>{TRAIN_TEXT.retry}</Button> : null}
    </div>
  );
}

export interface AutomatedSessionProps {
  session: SpotSession;
  grouping: Grouping;
  block: BlockView | null;
  holdout: HoldoutView | null;
  trackNames?: Readonly<Partial<Record<TrackKey, string>>>;
  interactive: boolean;
  onAskEnd: () => void;
  onExplain: () => void;
  onExplainDialog: (open: boolean) => void;
}

export function AutomatedSession(props: AutomatedSessionProps) {
  const { session, grouping, block, holdout, trackNames, interactive, onAskEnd, onExplain, onExplainDialog } = props;
  // The table's replay of the line before the decision, owned by the session (S38, O-381 to O-383).
  const { replay } = session;
  const { state } = session;
  const prompt = promptOf(state);
  const context = "context" in state ? state.context : null;
  const loading = state.kind === "loading_prompt" || state.kind === "stale";
  // The feedback sections the user opened or closed stay that way for the session (O-387).
  const feedbackSections = useFeedbackSections(context?.session.session_id ?? null);
  return (
    <div className="flex flex-col gap-4">
      {context === null ? null : (
        <BlockBanner block={block} holdout={holdout} ratedEligible={context.session.rated_eligible} {...(trackNames === undefined ? {} : { trackNames })} />
      )}
      {/* "Hand 7 of 20" once a session length is planned (S46, R3.31), by the drill run's one rule. */}
      {context === null ? null : <SessionHandCounter context={context} />}
      {loading ? <LoadingNote text={SESSION_TEXT.loadingPrompt} /> : null}
      {prompt === null ? null : (
        <>
          <DecisionArea
            table={<SpotTable prompt={prompt} replay={replay} />}
            state={state}
            prompt={prompt}
            grouping={grouping}
            interactive={interactive}
            replaying={replay.replaying}
            feedbackSections={feedbackSections}
            onChoose={session.chooseAction}
            onNext={session.next}
            onExplain={onExplain}
            onExplainDialog={onExplainDialog}
          />
        </>
      )}
      {canEnd(state) ? (
        <Button variant="secondary" aria-keyshortcuts={displayBinding(END_SESSION_BINDING)} disabled={!interactive} onClick={onAskEnd} className="self-start">
          <kbd aria-hidden="true" className="font-mono text-xs">
            {displayBinding(END_SESSION_BINDING)}
          </kbd>
          {SESSION_TEXT.endSession}
        </Button>
      ) : null}
    </div>
  );
}
