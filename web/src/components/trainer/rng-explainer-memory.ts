/**
 * Whether this browser has seen the RNG (random number generator) mode explainer (S25, R3.10,
 * O-283). Pure apart from the storage it is handed.
 *
 * Mechanism: the flag lives in localStorage under RNG_EXPLAINER_SEEN_KEY. The storage is
 * injected as a function that returns it, so tests pass their own and the default reads
 * window.localStorage lazily, at the moment of use: merely touching window.localStorage throws a
 * SecurityError when the browser blocks site data. Every access sits inside try and catch. A
 * missing storage or a DOMException (blocked access, private mode, a full quota) is a known
 * storage failure and is handled by returning "unavailable" or false, which the hook turns into
 * "show the explainer each time" (O-283), never a crash. Any other error is a bug, not a storage
 * state, so it propagates instead of being swallowed.
 */
export const RNG_EXPLAINER_SEEN_KEY = "gto-rng-explainer-seen";
export const EXPLAINER_SEEN_VALUE = "1";

/** The two Storage methods the memory needs; window.localStorage satisfies it. */
export interface ExplainerStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/** Returns the storage to use, or null when there is none. May throw a DOMException. */
export type ExplainerStorageSource = () => ExplainerStorage | null;

/** "unavailable": the storage is missing or failed, so nothing is known (show it each time). */
export type ExplainerSeenState = "seen" | "unseen" | "unavailable";

export function defaultExplainerStorage(): ExplainerStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function isStorageFailure(error: unknown): boolean {
  return error instanceof DOMException;
}

export function readExplainerSeen(source: ExplainerStorageSource = defaultExplainerStorage): ExplainerSeenState {
  try {
    const storage = source();
    if (storage === null) return "unavailable";
    return storage.getItem(RNG_EXPLAINER_SEEN_KEY) === EXPLAINER_SEEN_VALUE ? "seen" : "unseen";
  } catch (error: unknown) {
    if (isStorageFailure(error)) return "unavailable";
    throw error;
  }
}

/** Records that the explainer was shown; false when the storage is missing or failed. */
export function rememberExplainerSeen(source: ExplainerStorageSource = defaultExplainerStorage): boolean {
  try {
    const storage = source();
    if (storage === null) return false;
    storage.setItem(RNG_EXPLAINER_SEEN_KEY, EXPLAINER_SEEN_VALUE);
    return true;
  } catch (error: unknown) {
    if (isStorageFailure(error)) return false;
    throw error;
  }
}
