/**
 * The login limiter keyed on the account rather than the client (R3.1, A9 section 3, O-236 as
 * amended after the PR #20 reviews). The per-IP limits stop one client from guessing fast; this
 * one stops many clients, or one client with many addresses, from guessing one account's
 * password. It counts failed attempts only and a successful login resets the count (OWASP
 * Authentication Cheat Sheet), so correct logins never use up the budget and nobody can lock the
 * owner out indefinitely by sending logins for the owner's email: at worst the owner waits out
 * one window after the attacker's failures, and the per-IP limits bound how fast those come.
 *
 * Mechanism: a fixed window per key, opened by the key's first failure. check reads without
 * counting: a key with max failures inside its window is refused with the seconds until the
 * window ends. recordFailure counts one failure, reset forgets the key. State lives in memory (the
 * api is one process per host, like the per-IP limiter) and is bounded by maxKeys. Every failure
 * deletes and re-inserts its key, so the map's order is least recently failed first. When room is
 * needed, expired windows go first, then the least recently failed key that is still under the
 * limit; a key over the limit is never evicted, since evicting it would lift its lock. If every
 * tracked key is over the limit, a new key cannot be tracked and is treated as limited until a
 * window ends. The clock is injected so tests do not wait. Entries are replaced, never mutated.
 */
const MS_PER_SECOND = 1000;

export interface ThrottleOptions {
  max: number;
  windowMs: number;
  maxKeys: number;
  now?: () => number;
}

export type ThrottleVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };

interface Window {
  readonly startedAt: number;
  readonly failures: number;
}

export class LoginThrottle {
  readonly #windows = new Map<string, Window>();
  readonly #options: Required<ThrottleOptions>;

  constructor(options: ThrottleOptions) {
    this.#options = { now: Date.now, ...options };
  }

  /** Whether a login for the key may proceed; never counts. */
  check(key: string): ThrottleVerdict {
    const now = this.#options.now();
    const window = this.#liveWindow(key, now);
    if (window !== undefined) {
      return window.failures >= this.#options.max ? this.#refusal(window, now) : { allowed: true };
    }
    this.#dropExpired(now);
    if (this.#windows.size < this.#options.maxKeys || this.#evictableKey() !== undefined) {
      return { allowed: true };
    }
    return this.#refusal(this.#earliestWindow(), now);
  }

  /** Counts one failed login for the key. */
  recordFailure(key: string): void {
    const now = this.#options.now();
    const window = this.#liveWindow(key, now);
    const next: Window =
      window === undefined ? { startedAt: now, failures: 1 } : { startedAt: window.startedAt, failures: window.failures + 1 };
    this.#windows.delete(key);
    if (window === undefined && !this.#makeRoom(now)) {
      return;
    }
    this.#windows.set(key, next);
  }

  /** Forgets the key's failures (a successful login). */
  reset(key: string): void {
    this.#windows.delete(key);
  }

  get trackedKeys(): number {
    return this.#windows.size;
  }

  #liveWindow(key: string, now: number): Window | undefined {
    const window = this.#windows.get(key);
    return window !== undefined && now - window.startedAt < this.#options.windowMs ? window : undefined;
  }

  #refusal(window: Window | undefined, now: number): ThrottleVerdict {
    const endsAt = (window?.startedAt ?? now) + this.#options.windowMs;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((endsAt - now) / MS_PER_SECOND)) };
  }

  #dropExpired(now: number): void {
    for (const [key, window] of this.#windows) {
      if (now - window.startedAt >= this.#options.windowMs) {
        this.#windows.delete(key);
      }
    }
  }

  /** The least recently failed key still under the limit (map order is failure recency). */
  #evictableKey(): string | undefined {
    for (const [key, window] of this.#windows) {
      if (window.failures < this.#options.max) {
        return key;
      }
    }
    return undefined;
  }

  #earliestWindow(): Window | undefined {
    let earliest: Window | undefined;
    for (const window of this.#windows.values()) {
      if (earliest === undefined || window.startedAt < earliest.startedAt) {
        earliest = window;
      }
    }
    return earliest;
  }

  /** Frees a slot for a new key if one can be freed without lifting a lock. */
  #makeRoom(now: number): boolean {
    if (this.#windows.size < this.#options.maxKeys) {
      return true;
    }
    this.#dropExpired(now);
    if (this.#windows.size < this.#options.maxKeys) {
      return true;
    }
    const evictable = this.#evictableKey();
    if (evictable === undefined) {
      return false;
    }
    this.#windows.delete(evictable);
    return true;
  }
}
