/**
 * The short redirecting state after a successful sign-in or join (S42, R3.13, O-425): a near-empty
 * page with a spinner and one line, announced as a status. finishWithRedirect keeps it on screen
 * for at least REDIRECT_MIN_MS, so it reads as a step rather than a flash, then navigates.
 */
import { Spinner } from "./AuthShell.js";
import { REDIRECT_NOTE } from "./onboarding-text.js";

/** The least time the redirecting state shows (O-425). */
export const REDIRECT_MIN_MS = 400;

export interface RedirectingStateProps {
  title: string;
}

export function RedirectingState({ title }: RedirectingStateProps) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div role="status" className="flex flex-col items-center gap-1 text-center">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <Spinner />
          {title}
        </p>
        <p className="text-sm text-muted">{REDIRECT_NOTE}</p>
      </div>
    </main>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Waits out the minimum display time, then runs the navigation. */
export async function finishWithRedirect(navigate: () => Promise<void>): Promise<void> {
  await wait(REDIRECT_MIN_MS);
  await navigate();
}
