/**
 * Per-test budget for the suites that render the full 13 by 13 range painter (S27, R3.17). Each of
 * those tests clicks through 169 buttons with user-event and takes 2 to 5 s alone; under
 * `just ts-test`, which runs the web and api suites in parallel, they passed the 5,000 ms default.
 * The budget is three times the default and applies only to these describe blocks, so the rest of
 * the web suite keeps the default. Testing Library's async timeout stays at 5,000 ms (test/setup.ts).
 */
export const PAINTER_TEST_TIMEOUT_MS = 15_000;

/** The describe options for a painter suite. */
export const PAINTER_SUITE = { timeout: PAINTER_TEST_TIMEOUT_MS } as const;
