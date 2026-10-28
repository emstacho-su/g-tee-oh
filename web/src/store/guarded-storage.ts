/**
 * Guarded localStorage access for the per-browser preference stores (S32, O-323, O-266).
 *
 * Mechanism: storage can be missing or can throw (private windows, blocked site data, a full
 * quota), so every read and write sits in try and catch. A failed read answers null and a failed
 * write is dropped: the preference still applies for this page, it is only not remembered. Values
 * are JSON; text that does not parse reads as null, and each store validates what it gets.
 */

export function defaultStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The parsed JSON under a key, or null when it is missing, unreadable or not JSON. */
export function readJson(storage: Storage | null, key: string): unknown {
  try {
    const text = storage?.getItem(key);
    return text === null || text === undefined ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export function writeJson(storage: Storage | null, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is a convenience only (O-323); the choice still applies for this page.
  }
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
