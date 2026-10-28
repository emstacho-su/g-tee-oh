/**
 * The table of a trainer prompt (S25, S38, R3.13, O-57, O-281, O-381 to O-383, A7 section 3): the
 * synthetic banner when the prompt's solution is synthetic test data, then the PokerTable with the
 * seats from the prompt (prompt-seats.ts), the board on the felt, and the actions before the
 * hero's decision played on the table instead of a text line (screen review row 44).
 *
 * Mechanism: the replay (trainer/use-action-replay.ts) says how many history entries are shown
 * and which one is playing. Each seat shows its last shown action as a badge, folds as Folded,
 * and an action that puts chips in as a chip at its bet spot; the playing seat is marked active
 * and its chip slides in. A click on the table finishes the replay at once. A visually hidden
 * role="log" named "Action this hand" adds one line per action as it plays and "Your turn" at
 * the end, so a screen reader hears each action in order (O-383); it replaces the visible
 * "Action so far" list. A page that gates its action bar on the replay owns the hook and passes
 * `replay`; without it SpotTable runs its own replay with the given speed. Every label and amount
 * is the api's, only formatted (ADR 0004).
 */
import { BoardReveal, PokerTable, type TableSeat } from "../../components/table/index.js";
import { SyntheticBanner } from "../../components/ui/index.js";
import type { TrainerPrompt } from "../../contracts.js";
import type { ReplaySpeed } from "../../trainer/action-replay.js";
import { seatsOfPrompt } from "../../trainer/prompt-seats.js";
import { useActionReplay, type ActionReplay } from "../../trainer/use-action-replay.js";

export const ACTION_LOG_NAME = "Action this hand";

export interface SpotTableProps {
  prompt: TrainerPrompt;
  /** The page's replay of this prompt (useActionReplay); SpotTable runs its own when absent. */
  replay?: ActionReplay;
  /** The drill's trainer.speed, for SpotTable's own replay; normal when absent. */
  speed?: ReplaySpeed;
}

/** The prompt's seats as the replay has them so far. */
export function replaySeats(seats: readonly TableSeat[], replay: ActionReplay): TableSeat[] {
  return seats.map((seat) => {
    const action = replay.seats.get(seat.position);
    const active = replay.activePosition === seat.position;
    const base: TableSeat = { ...seat, hasFolded: action?.folded ?? false, active };
    if (action === undefined || action.folded) return base;
    const withBadge: TableSeat = { ...base, lastAction: action.label };
    return action.chip === null
      ? withBadge
      : { ...withBadge, chip: { label: action.chip, moving: active, durationMs: active ? (replay.stepMs ?? 0) : 0 } };
  });
}

function ActionLog({ replay }: { replay: ActionReplay }) {
  return (
    <div role="log" aria-label={ACTION_LOG_NAME} aria-live="polite" data-testid="action-log" className="sr-only">
      {replay.log.map((line) => (
        <p key={line.key}>{line.text}</p>
      ))}
    </div>
  );
}

function SpotTableView({ prompt, replay }: { prompt: TrainerPrompt; replay: ActionReplay }) {
  return (
    <div className="flex flex-col gap-3">
      {prompt.synthetic ? <SyntheticBanner /> : null}
      <PokerTable
        seats={replaySeats(seatsOfPrompt(prompt), replay)}
        potCbb={prompt.pot_cbb}
        center={<BoardReveal cards={prompt.board} />}
        replaying={replay.replaying}
        onClick={replay.skip}
      />
      <ActionLog replay={replay} />
    </div>
  );
}

function OwnReplaySpotTable({ prompt, speed }: { prompt: TrainerPrompt; speed: ReplaySpeed | undefined }) {
  const replay = useActionReplay(prompt, speed === undefined ? {} : { speed });
  return <SpotTableView prompt={prompt} replay={replay} />;
}

export function SpotTable({ prompt, replay, speed }: SpotTableProps) {
  return replay === undefined ? <OwnReplaySpotTable prompt={prompt} speed={speed} /> : <SpotTableView prompt={prompt} replay={replay} />;
}
