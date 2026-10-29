/**
 * Keys held back for a later feature (S46, R3.30, O-473). Nothing registers them; the shortcuts
 * overlay and the /settings table list them as reserved so no surface takes them in the meantime.
 */
export interface ReservedKey {
  readonly key: string;
  readonly description: string;
  readonly scope: string;
}

/** R repeats the hand once the api can replay a prompt (O-473). */
export const REPEAT_HAND_KEY = "R";
export const REPEAT_HAND_DESCRIPTION = "Repeat hand (reserved until the api can replay a prompt)";
/** The trainer's session scope label; routes/drill-run/labels.ts SESSION_SCOPE reads the same word. */
const RESERVED_SESSION_SCOPE = "Session";

export const RESERVED_KEYS: readonly ReservedKey[] = [{ key: REPEAT_HAND_KEY, description: REPEAT_HAND_DESCRIPTION, scope: RESERVED_SESSION_SCOPE }];
