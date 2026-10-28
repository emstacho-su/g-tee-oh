/**
 * Per-test budget for the S41 suites that render the whole app and type answers and reasons with
 * user-event (R3.16, R4.12): the quiz screens and the frequency card on /progress. Alone each test
 * takes under 3.5 s; under load (`just ts-test` runs the web and api suites in parallel, and other
 * lanes share the machine) they passed the 5,000 ms default, as the painter suites did
 * (test/paint/painter-timeout.ts). The budget is three times the default and applies only to these
 * describe blocks; Testing Library's async timeout stays at 5,000 ms (test/setup.ts).
 */
export const APP_SUITE_TEST_TIMEOUT_MS = 15_000;

/** The describe options for a whole-app suite. */
export const APP_SUITE = { timeout: APP_SUITE_TEST_TIMEOUT_MS } as const;
