/**
 * The drill session, /drills/$id/run: the trainer in spot mode (S25, S37, R3.13, R3.10, A7
 * sections 2 to 4, O-282 to O-285, O-288, ADR 0018).
 *
 * Mechanism: the page reads the drill (GET /drills/{id}) and shows the start panel: its name,
 * grouping and stop rule, a Mixed-frequency mode switch (the wire name stays rng) that starts at trainer.rng and overrides it for this
 * session only, and Start. Start runs useSpotSession (the pure machine in trainer/spot-machine.ts
 * and its requests), with the route's validated seed passed to POST /sessions (O-288). In a session
 * the page shows the table from the prompt, the decision area (the roll scale, actions, which
 * submit when chosen (O-345), feedback, Next), an End session button with a confirm dialog, and the recap after the end.
 *
 * The Mixed-frequency mode explainer (lane C's useRngExplainer and RngExplainer) opens on first
 * use: when the switch is turned on, and at the first prompt of a session that shows a roll (O-283);
 * the roll scale's info button and the I key open it at any time. Hotkeys (O-285) go through
 * useHotkey: N next hand (only on the reveal), E end session (opens the confirm), plus 1 to 9 from
 * the action bar (the S and U keys left with the confidence tap, O-345). While a dialog is open the screen's buttons and hotkeys pause.
 *
 * S26 (R3.13, R3.14, O-312 to O-314): the drill's run settings (stop rule, pause, speed,
 * quick_result) go into the session, so street and full-hand modes run on the same screen; above
 * the table RunProgress shows the covered-part note and the hand and decision counter (S40, O-352:
 * how the last hand ended is logged by the api, not shown), and a start refused with 422
 * no-coverage adds the queued count and a library link.
 *
 * S47 (R3.36, R3.4, O-484, O-487): ?start=1 starts the session once the drill is read
 * (use-autostart.ts); the start panel offers session-only pause and speed overrides behind Options
 * and an Edit drill link; after a 422 no-coverage, CoverageWatch listens for a coverage_added on a
 * configuration the drill reaches and, when one arrives, clears the refusal and says so.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useAppApi } from "../../auth/index.js";
import { RngExplainer, useFeedbackSections, useRngExplainer } from "../../components/trainer/index.js";
import { Button, LoadingNote, PageHeader } from "../../components/ui/index.js";
import type { TrainerPrompt } from "../../contracts.js";
import { useHotkey } from "../../hotkeys/index.js";
import { runSettingsOf } from "../../trainer/pause-rule.js";
import { validateDrillRunSearch } from "../../trainer/run-search.js";
import { drillQuery } from "../../trainer/session-api.js";
import type { Drill } from "../../trainer/session-types.js";
import { canEnd, type SpotState } from "../../trainer/spot-machine.js";
import { useSpotSession, type SpotSession } from "../../trainer/use-spot-session.js";
import { NoCoverageNote } from "./CoverageNote.js";
import { CoverageWatch } from "./CoverageWatch.js";
import { DecisionArea } from "./DecisionArea.js";
import { END_SESSION_KEY, SESSION_SCOPE, SESSION_TEXT } from "./labels.js";
import { RunProgress } from "./RunProgress.js";
import { SessionOverrides, type SessionOverrideValues } from "./SessionOverrides.js";
import { EndSessionDialog, SessionAlert, SessionRecapView } from "./SessionParts.js";
import { SpotTable } from "./SpotTable.js";
import { StartPanel } from "./StartPanel.js";
import { useAutostart } from "./use-autostart.js";

export interface DrillRunPageProps {
  drillId: string;
  seed?: string;
  /** The address carried start=1 (S47, R3.36, O-484): the session starts once the drill is read. */
  autostart?: boolean;
}

/** The prompt on screen in a state, if any. */
function promptOf(state: SpotState): TrainerPrompt | null {
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

function onStartPanel(state: SpotState): boolean {
  return state.kind === "idle" || state.kind === "starting" || (state.kind === "error" && state.context === null);
}

/** Asks the explainer once per session, at the first prompt that shows a roll (O-283). */
function useFirstRollExplainer(state: SpotState, showIfFirstUse: () => void): void {
  const askedFor = useRef<string | null>(null);
  const prompt = promptOf(state);
  const sessionId = prompt?.session_id ?? null;
  const rolled = prompt !== null && prompt.rng_roll !== null;
  useEffect(() => {
    if (!rolled || sessionId === null || askedFor.current === sessionId) return;
    askedFor.current = sessionId;
    showIfFirstUse();
  }, [rolled, sessionId, showIfFirstUse]);
}

interface InSessionProps {
  drill: Drill;
  session: SpotSession;
  interactive: boolean;
  onAskEnd: () => void;
  onExplain: () => void;
  onExplainDialog: (open: boolean) => void;
}

function InSession({ drill, session, interactive, onAskEnd, onExplain, onExplainDialog }: InSessionProps) {
  // The table's replay of the line before the decision, owned by the session (S38, O-381 to O-383).
  const { state, replay } = session;
  const prompt = promptOf(state);
  const loading = state.kind === "loading_prompt" || state.kind === "stale";
  const context = "context" in state ? state.context : null;
  // The feedback sections the user opened or closed stay that way for the session (O-387).
  const feedbackSections = useFeedbackSections(context?.session.session_id ?? null);
  return (
    <div className="flex flex-col gap-4">
      {context === null ? null : <RunProgress context={context} />}
      {loading ? <LoadingNote text={SESSION_TEXT.loadingPrompt} /> : null}
      {prompt === null ? null : (
        <>
          <DecisionArea
            table={<SpotTable prompt={prompt} replay={replay} />}
            state={state}
            prompt={prompt}
            grouping={drill.trainer.grouping}
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
        <Button variant="secondary" aria-keyshortcuts={END_SESSION_KEY} disabled={!interactive} onClick={onAskEnd} className="self-start">
          <kbd aria-hidden="true" className="font-mono text-xs">
            {END_SESSION_KEY}
          </kbd>
          {SESSION_TEXT.endSession}
        </Button>
      ) : null}
    </div>
  );
}

interface DrillRunProps {
  drill: Drill;
  seed: string | undefined;
  autostart: boolean;
}

function DrillRun({ drill, seed, autostart }: DrillRunProps) {
  const [rng, setRng] = useState(drill.trainer.rng);
  // Session-only pause and speed (S47, O-487) and the line CoverageWatch leaves when the library caught up.
  const [overrides, setOverrides] = useState<SessionOverrideValues>({});
  const [coverageNote, setCoverageNote] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // S27: More info and Ask dialogs pause the screen like the explainer and the end confirm.
  const [explainDialogOpen, setExplainDialogOpen] = useState(false);
  const explainer = useRngExplainer({ hotkey: rng });
  const interactive = !confirmOpen && !explainer.open && !explainDialogOpen;
  // Time under the explainer or the end confirm is not response time (O-284); the session pauses
  // the timer for the table's replay itself (O-381), at the drill's speed.
  const session = useSpotSession({
    spec: { mode: "drill", drillId: drill.id, seed },
    paused: !interactive,
    trainer: runSettingsOf({ ...drill.trainer, ...overrides }),
  });
  const { state } = session;
  const startPanel = onStartPanel(state);
  useAutostart({ enabled: autostart, ready: state.kind === "idle", start: () => session.start(rng) });
  const noCoverage = state.kind === "error" && state.problem.kind === "no_coverage";
  const coverageArrived = (text: string): void => {
    setCoverageNote(text);
    session.reset();
  };
  useFirstRollExplainer(state, explainer.showIfFirstUse);
  useHotkey(
    { key: END_SESSION_KEY, description: SESSION_TEXT.endSession, scope: SESSION_SCOPE, handler: () => setConfirmOpen(true) },
    canEnd(state) && interactive,
  );
  const changeRng = (next: boolean) => {
    setRng(next);
    if (next) explainer.showIfFirstUse();
  };
  const confirmEnd = () => {
    setConfirmOpen(false);
    session.end();
  };
  return (
    <>
      {state.kind === "error" ? (
        // On the start panel, Start is the retry (it reuses the request's key when nothing changed);
        // in a session, a fixed answer offers End instead of a retry that cannot succeed.
        <SessionAlert problem={state.problem} canRetry={state.retry !== null && !startPanel} onRetry={session.retry} />
      ) : null}
      {state.kind === "error" && startPanel ? <NoCoverageNote problem={state.problem} /> : null}
      {noCoverage ? <CoverageWatch drill={drill} onCoverage={coverageArrived} /> : null}
      {state.kind === "ended" ? <SessionRecapView recap={state.recap} onStartAnother={session.reset} /> : null}
      {startPanel ? (
        <StartPanel
          drill={drill}
          rng={rng}
          onRngChange={changeRng}
          onStart={() => {
            setCoverageNote(null);
            session.start(rng);
          }}
          starting={state.kind === "starting"}
          options={<SessionOverrides trainer={runSettingsOf(drill.trainer)} value={overrides} onChange={setOverrides} />}
          editLink
          note={coverageNote}
        />
      ) : null}
      {state.kind !== "ended" && !startPanel ? (
        <InSession drill={drill} session={session} interactive={interactive} onAskEnd={() => setConfirmOpen(true)} onExplain={() => explainer.setOpen(true)} onExplainDialog={setExplainDialogOpen} />
      ) : null}
      {state.kind === "ending" ? <LoadingNote text={SESSION_TEXT.ending} /> : null}
      <EndSessionDialog open={confirmOpen} onOpenChange={setConfirmOpen} onConfirm={confirmEnd} />
      <RngExplainer open={explainer.open} onOpenChange={explainer.setOpen} />
    </>
  );
}

export function DrillRunPage({ drillId, seed: rawSeed, autostart = false }: DrillRunPageProps) {
  const api = useAppApi();
  const drill = useQuery(drillQuery(api, drillId));
  // The route validates the seed, but TanStack Router merges the parent route's unvalidated search
  // into the child's, so a malformed seed can still arrive here; check it again at this boundary.
  const { seed } = validateDrillRunSearch(rawSeed === undefined ? {} : { seed: rawSeed });
  return (
    <section className="flex flex-col gap-4" data-drill-id={drillId}>
      <PageHeader title={SESSION_TEXT.heading} />
      {drill.isPending ? <LoadingNote text={SESSION_TEXT.loadingDrill} /> : null}
      {/* A failed background refetch keeps the cached drill, so a running session stays on screen. */}
      {drill.isError && drill.data === undefined ? <p role="alert" className="text-danger">This drill could not be loaded. Check the link, or open it again from the drill library.</p> : null}
      {drill.data === undefined ? null : <DrillRun drill={drill.data} seed={seed} autostart={autostart} />}
    </section>
  );
}
