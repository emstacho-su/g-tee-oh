/**
 * The login limiter keyed on the account rather than the client (R3.1, A9 section 3, O-236 as
 * amended after the PR #20 security review). The per-IP limit stops one client from guessing fast;
 * this one stops many clients, or one client that controls many addresses, from guessing one
 * account's password: every login attempt for a normalized email counts, whoever sends it.
 *
 * Mechanism: a fixed window per key. The first attempt for a key opens a window of windowMs; each
 * attempt inside it counts; past max, attempts are refused with the seconds until the window
 * ends. The state lives in memory (the api is one process per host, like the per-IP limiter) and
 * is bounded: when maxKeys keys are tracked, expired windows are dropped, and if every window is
 * still live the oldest is dropped, so a flood of distinct emails cannot grow the map without
 * limit. The clock is injected so tests do not wait. Updates replace entries, never mutate them.
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
  readonly count: number;
}

export class LoginThrottle {
  readonly #windows = new Map<string, Window>();
  readonly #options: Required<ThrottleOptions>;

  constructor(options: ThrottleOptions) {
    this.#options = { now: Date.now, ...options };
  }

  /** Counts one attempt for the key and says whether it may proceed. */
  hit(key: string): ThrottleVerdict {
    const now = this.#options.now();
    const current = this.#windows.get(key);
    const live = current !== undefined && now - current.startedAt < this.#options.windowMs;
    const next: Window = live ? { startedAt: current.startedAt, count: current.count + 1 } : { startedAt: now, count: 1 };
    if (!live) {
      this.#makeRoom(now);
    }
    this.#windows.set(key, next);
    if (next.count <= this.#options.max) {
      return { allowed: true };
    }
    const remainingMs = next.startedAt + this.#options.windowMs - now;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / MS_PER_SECOND)) };
  }

  get trackedKeys(): number {
    return this.#windows.size;
  }

  #makeRoom(now: number): void {
    if (this.#windows.size < this.#options.maxKeys) {
      return;
    }
    for (const [key, window] of this.#windows) {
      if (now - window.startedAt >= this.#options.windowMs) {
        this.#windows.delete(key);
      }
    }
    if (this.#windows.size >= this.#options.maxKeys) {
      const oldest = this.#windows.keys().next();
      if (oldest.done !== true) {
        this.#windows.delete(oldest.value);
      }
    }
  }
}
