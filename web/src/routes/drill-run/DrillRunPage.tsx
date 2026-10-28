/**
 * The drill session, /drills/$id/run: the trainer in spot mode (S25, R3.13, R3.11, R3.10, A7
 * sections 2 to 4, O-282 to O-285, O-288, ADR 0018).
 *
 * Mechanism: the page reads the drill (GET /drills/{id}) and shows the start panel: its name,
 * grouping and stop rule, an RNG mode switch that starts at trainer.rng and overrides it for this
 * session only, and Start. Start runs useSpotSession (the pure machine in trainer/spot-machine.ts
 * and its requests), with the route's validated seed passed to POST /sessions (O-288). In a session
 * the page shows the table from the prompt, the decision area (roll, actions, confidence tap,
 * feedback, Next), an End session button with a confirm dialog, and the recap after the end.
 *
 * The RNG explainer (lane C's useRngExplainer and RngExplainer) opens on first use: when the switch
 * is turned on, and at the first prompt of a session that shows a roll (O-283); the roll badge, the
 * roller and the I key open it at any time. Hotkeys (O-285) go through useHotkey: N next hand (only
 * on the reveal), E end session (opens the confirm), plus 1 to 9, S and U from the trainer
 * components. While a dialog is open the screen's buttons and hotkeys pause.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useAppApi } from "../../auth/index.js";
import { RngExplainer, useRngExplainer } from "../../components/trainer/index.js";
import { Button, LoadingNote } from "../../components/ui/index.js";
import type { TrainerPrompt } from "../../contracts.js";
import { useHotkey } from "../../hotkeys/index.js";
import { validateDrillRunSearch } from "../../trainer/run-search.js";
import { drillQuery } from "../../trainer/session-api.js";
import type { Drill } from "../../trainer/session-types.js";
import { canEnd, type SpotState } from "../../trainer/spot-machine.js";
import { useSpotSession, type SpotSession } from "../../trainer/use-spot-session.js";
import { DecisionArea } from "./DecisionArea.js";
import { END_SESSION_KEY, SESSION_SCOPE, SESSION_TEXT } from "./labels.js";
import { EndSessionDialog, SessionAlert, SessionRecapView } from "./SessionParts.js";
import { SpotTable } from "./SpotTable.js";
import { StartPanel } from "./StartPanel.js";

export interface DrillRunPageProps {
  drillId: string;
  seed?: string;
}

/** The prompt on screen in a state, if any. */
function promptOf(state: SpotState): TrainerPrompt | null {
  switch (state.kind) {
    case "await_action":
    case "await_confidence":
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
  const { state } = session;
  const prompt = promptOf(state);
  const loading = state.kind === "loading_prompt" || state.kind === "stale";
  return (
    <div className="flex flex-col gap-4">
      {loading ? <LoadingNote text={SESSION_TEXT.loadingPrompt} /> : null}
      {prompt === null ? null : (
        <>
          <SpotTable prompt={prompt} />
          <DecisionArea
            state={state}
            prompt={prompt}
            grouping={drill.trainer.grouping}
            interactive={interactive}
            onChoose={session.chooseAction}
            onConfidence={session.tapConfidence}
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
}

function DrillRun({ drill, seed }: DrillRunProps) {
  const [rng, setRng] = useState(drill.trainer.rng);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // S27: More info and Ask dialogs pause the screen like the explainer and the end confirm.
  const [explainDialogOpen, setExplainDialogOpen] = useState(false);
  const explainer = useRngExplainer({ hotkey: rng });
  const interactive = !confirmOpen && !explainer.open && !explainDialogOpen;
  // Time under the explainer or the end confirm is not response time (O-284).
  const session = useSpotSession({ drillId: drill.id, seed, paused: !interactive });
  const { state } = session;
  const startPanel = onStartPanel(state);
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
      {state.kind === "ended" ? <SessionRecapView recap={state.recap} onStartAnother={session.reset} /> : null}
      {startPanel ? (
        <StartPanel drill={drill} rng={rng} onRngChange={changeRng} onStart={() => session.start(rng)} starting={state.kind === "starting"} />
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

export function DrillRunPage({ drillId, seed: rawSeed }: DrillRunPageProps) {
  const api = useAppApi();
  const drill = useQuery(drillQuery(api, drillId));
  // The route validates the seed, but TanStack Router merges the parent route's unvalidated search
  // into the child's, so a malformed seed can still arrive here; check it again at this boundary.
  const { seed } = validateDrillRunSearch(rawSeed === undefined ? {} : { seed: rawSeed });
  return (
    <section className="flex flex-col gap-4" data-drill-id={drillId}>
      <h1 className="text-2xl font-semibold">{SESSION_TEXT.heading}</h1>
      {drill.isPending ? <LoadingNote text={SESSION_TEXT.loadingDrill} /> : null}
      {/* A failed background refetch keeps the cached drill, so a running session stays on screen. */}
      {drill.isError && drill.data === undefined ? <p role="alert" className="text-danger">This drill could not be loaded. Check the link, or open it again from the drill library.</p> : null}
      {drill.data === undefined ? null : <DrillRun drill={drill.data} seed={seed} />}
    </section>
  );
}
