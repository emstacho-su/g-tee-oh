/**
 * In-memory holder for the session's CSRF (cross-site request forgery) token (R3.13, O-230,
 * A9 section 3). The token comes from POST /auth/login or GET /me and goes out as x-csrf-token
 * on every mutating request. It lives in this closure only: never localStorage, sessionStorage or
 * a cookie the page sets, so script on another tab or a stored-data leak cannot read it. A page
 * reload therefore empties it, and csrf-fetch.ts recovers it through GET /me before a mutation.
 */

export interface CsrfTokenHolder {
  get: () => string | null;
  set: (token: string) => void;
  clear: () => void;
}

export function createCsrfTokenHolder(): CsrfTokenHolder {
  let token: string | null = null;
  return {
    get: () => token,
    set: (next) => {
      token = next;
    },
    clear: () => {
      token = null;
    },
  };
}
