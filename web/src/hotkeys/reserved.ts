/**
 * Keys the shortcuts overlay and the /settings table list although no useHotkey binding stands
 * behind them (S46, R3.30, O-473): R, held back for repeat hand, and Space, which the table
 * replay's own listener reads to skip the replay (trainer/use-action-replay.ts). Both belong to
 * the trainer session's scope, defined here once (PR #45 review round 3, findings 4 and 9).
 */
export interface ReservedKey {
  readonly key: string;
  readonly description: string;
  readonly scope: string;
}

/** The trainer session's hotkey scope; routes/drill-run/labels.ts re-exports it. */
export const SESSION_SCOPE = "Session";

/** R repeats the hand once the api can replay a prompt (O-473); the row's words name no api (S48 round 5 verifier). */
export const REPEAT_HAND_KEY = "R";
export const REPEAT_HAND_DESCRIPTION = "Repeat hand (reserved until a hand can be replayed)";

/** The space bar skips the table replay (S46, R3.30, O-475). */
export const REPLAY_SKIP_KEY = " ";
export const REPLAY_SKIP_DESCRIPTION = "Skip the replay";

export const RESERVED_KEYS: readonly ReservedKey[] = [{ key: REPEAT_HAND_KEY, description: REPEAT_HAND_DESCRIPTION, scope: SESSION_SCOPE }];

/** Keys read outside the registry, listed beside the scope's live keys. */
export const LISTENER_KEYS: readonly ReservedKey[] = [{ key: REPLAY_SKIP_KEY, description: REPLAY_SKIP_DESCRIPTION, scope: SESSION_SCOPE }];
