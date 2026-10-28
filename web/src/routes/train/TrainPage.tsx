/**
 * /train: automated training and the monthly holdout retest (S32, R4.10, R4.12, O-272, O-323,
 * O-325, O-326, O-328, A7 section 2).
 *
 * Mechanism: the page runs useSpotSession with a start spec (trainer/session-api.ts). In automated
 * mode the spec takes the grouping, Mixed-frequency mode and configuration scope from the session defaults
 * (lane C's store, O-323) and never a seed; in holdout mode (/train?mode=holdout, the holdout
 * card's button) the spec is the mode alone and RNG is off. The screen follows the machine's
 * state: the start panel (AutomatedStart or HoldoutStart) before a session and after a failed
 * start, the running session (AutomatedSession: block banner, table, decision area, End), and the
 * recap (TrainingRecap) after the end. Every prompt shown is marked (block-progress.ts), so the
 * banner can count the hands of the block from the session's first block. Track names come from
 * the tracks read and later classes' families from the heat map read; both fall back quietly (to
 * the key, to no family) while loading or after a failure, since the session does not need them.
 *
 * Ending a session invalidates every progress read (in useSpotSession, O-326), so the home and
 * /progress cards refetch. A 401 from any request signs out (the hook sets me to null and the
 * authenticated layout goes to /login). As on the drill run, the Mixed-frequency mode explainer opens at the first
 * rolled prompt on first use, E opens the end confirm, and the screen's buttons, hotkeys and
 * response timer pause while a dialog is open (O-284, O-285).
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAppApi } from "../../auth/index.js";
import { RngExplainer, useRngExplainer } from "../../components/trainer/index.js";
import { LoadingNote, PageHeader } from "../../components/ui/index.js";
import type { Grouping } from "../../contracts.js";
import { useHotkey } from "../../hotkeys/index.js";
import { heatmapQuery, tracksQuery } from "../../progress/queries.js";
import type { TrackKey } from "../../progress/types.js";
import { ALL_CONFIGS, useSessionDefaultsStore, type SessionDefaults } from "../../store/session-defaults.js";
import type { SessionStartSpec } from "../../trainer/session-api.js";
import { canEnd, type SpotState } from "../../trainer/spot-machine.js";
import { useActionReplay } from "../../trainer/use-action-replay.js";
import { useSpotSession } from "../../trainer/use-spot-session.js";
import { NoCoverageNote } from "../drill-run/CoverageNote.js";
import { END_SESSION_KEY, SESSION_SCOPE, SESSION_TEXT } from "../drill-run/labels.js";
import { EndSessionDialog } from "../drill-run/SessionParts.js";
import { AutomatedStart, HoldoutStart } from "./AutomatedStart.js";
import { AutomatedSession, onStartPanel, promptOf, TrainAlert } from "./AutomatedSession.js";
import { blockView, familyLookup, holdoutView, latestPromptDecided, withMark, type PromptMark } from "./block-progress.js";
import { TRAIN_TEXT, type TrainMode } from "./train-text.js";
import { TrainingRecap } from "./TrainingRecap.js";

/** A holdout retest is graded with the api's fixed settings: standard grouping, no RNG. */
const HOLDOUT_GROUPING: Grouping = "standard";

export interface TrainPageProps {
  mode: TrainMode;
}

function startSpec(mode: TrainMode, defaults: SessionDefaults): SessionStartSpec {
  if (mode === "holdout") return { mode: "holdout" };
  const configIds = defaults.configScope === ALL_CONFIGS ? null : defaults.configScope;
  return { mode: "automated", grouping: defaults.grouping, configIds };
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

/** Track names by key from the tracks read; undefined while it loads or after a failure. */
function useTrackNames(): Readonly<Partial<Record<TrackKey, string>>> | undefined {
  const api = useAppApi();
  const tracks = useQuery(tracksQuery(api));
  return useMemo(() => (tracks.data === undefined ? undefined : Object.fromEntries(tracks.data.map((track) => [track.track_key, track.name]))), [tracks.data]);
}

function TrainRun({ mode }: TrainPageProps) {
  const api = useAppApi();
  const defaults = useSessionDefaultsStore((store) => store.defaults);
  const [marks, setMarks] = useState<readonly PromptMark[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [explainDialogOpen, setExplainDialogOpen] = useState(false);
  const rng = mode === "automated" && defaults.rng;
  const explainer = useRngExplainer({ hotkey: rng });
  const interactive = !confirmOpen && !explainer.open && !explainDialogOpen;
  // The replay's last known state: the session is created before the replay reads its prompt.
  const [replaying, setReplaying] = useState(false);
  // Time under a dialog or the opponent-action replay is not response time (O-284, O-381).
  const session = useSpotSession({
    spec: startSpec(mode, defaults),
    paused: !interactive || replaying,
    onPrompt: (prompt) => setMarks((current) => withMark(current, prompt)),
  });
  const { state } = session;
  // Automated and holdout sessions keep the normal speed (no run settings, O-325).
  const replay = useActionReplay(promptOf(state));
  useEffect(() => setReplaying(replay.replaying), [replay.replaying]);
  const trackNames = useTrackNames();
  const heatmap = useQuery({ ...heatmapQuery(api), enabled: mode === "automated" });
  const context = "context" in state ? state.context : null;
  const block = blockView(context?.session.automated ?? null, marks, familyLookup(heatmap.data));
  const holdout = holdoutView(context?.session.holdout ?? null, marks, latestPromptDecided(state, marks.length));
  const startPanel = onStartPanel(state);
  useFirstRollExplainer(state, explainer.showIfFirstUse);
  useHotkey(
    { key: END_SESSION_KEY, description: SESSION_TEXT.endSession, scope: SESSION_SCOPE, handler: () => setConfirmOpen(true) },
    canEnd(state) && interactive,
  );
  const confirmEnd = () => {
    setConfirmOpen(false);
    session.end();
  };
  const trainAgain = () => {
    setMarks([]);
    session.reset();
  };
  const starting = state.kind === "starting";
  return (
    <>
      {state.kind === "error" ? <TrainAlert mode={mode} problem={state.problem} onStart={startPanel} canRetry={state.retry !== null && !startPanel} onRetry={session.retry} /> : null}
      {state.kind === "error" && startPanel && mode === "automated" ? <NoCoverageNote problem={state.problem} /> : null}
      {state.kind === "ended" ? <TrainingRecap recap={state.recap} onTrainAgain={trainAgain} {...(trackNames === undefined ? {} : { trackNames })} /> : null}
      {startPanel && mode === "automated" ? <AutomatedStart defaults={defaults} starting={starting} onStart={() => session.start(rng)} /> : null}
      {startPanel && mode === "holdout" ? <HoldoutStart starting={starting} onStart={() => session.start(false)} /> : null}
      {state.kind !== "ended" && !startPanel ? (
        <AutomatedSession
          session={session}
          // The started session's own grouping once it exists, so a defaults change mid-session changes nothing (PR #33 review round 1).
          grouping={context?.session.grouping ?? (mode === "holdout" ? HOLDOUT_GROUPING : defaults.grouping)}
          block={block}
          holdout={holdout}
          replay={replay}
          interactive={interactive}
          onAskEnd={() => setConfirmOpen(true)}
          onExplain={() => explainer.setOpen(true)}
          onExplainDialog={setExplainDialogOpen}
          {...(trackNames === undefined ? {} : { trackNames })}
        />
      ) : null}
      {state.kind === "ending" ? <LoadingNote text={SESSION_TEXT.ending} /> : null}
      <EndSessionDialog open={confirmOpen} onOpenChange={setConfirmOpen} onConfirm={confirmEnd} />
      <RngExplainer open={explainer.open} onOpenChange={explainer.setOpen} />
    </>
  );
}

export function TrainPage({ mode }: TrainPageProps) {
  return (
    <section className="flex flex-col gap-4" data-train-mode={mode}>
      <PageHeader title={mode === "holdout" ? TRAIN_TEXT.holdoutHeading : TRAIN_TEXT.automatedHeading} />
      {/* A new mode is a new screen: the key drops the other mode's session state. */}
      <TrainRun key={mode} mode={mode} />
    </section>
  );
}
