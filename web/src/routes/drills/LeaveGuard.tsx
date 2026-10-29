/**
 * The builder's leave guard (S40, R3.14, O-405 as the PM changed it): while the draft holds unsaved
 * edits, leaving the builder asks first.
 *
 * Mechanism: a router blocker (TanStack Router useBlocker with a resolver) blocks a navigation
 * when the draft is dirty and the next location is not a page of the same builder, and the
 * components/ui Dialog asks "Leave without saving?": Leave proceeds, Keep editing (or closing the
 * dialog) resets. Moving between pages of the same builder (/drills/new/<page> or
 * /drills/<id>/<page>, only the page differs) is not leaving. Whether the draft is dirty is read
 * from a ref at the moment of the navigation, so the caller can mark the draft clean right before
 * its own navigation after a save. A beforeunload listener is added only while the draft is
 * dirty, so a reload or a closed tab asks the browser's own question; it is removed once clean.
 * Signing out goes to /login and is never blocked (security review L4): the unsaved edits go with
 * the session. The builder's own move after a create skips the blocker (DrillForm, ignoreBlocker).
 */
import { useBlocker } from "@tanstack/react-router";
import { useEffect, type RefObject } from "react";

import { Button, Dialog } from "../../components/ui/index.js";
import { isBuilderSection } from "../../drills/builder-sections.js";

export const LEAVE_TEXT = {
  title: "Leave without saving?",
  description: "Your changes to this drill are not saved. Leaving drops them.",
  leave: "Leave",
  stay: "Keep editing",
} as const;

const SEPARATOR = "/";
/** Signing out (or a lapsed session) goes here; it is never held back (security review L4). */
const LOGIN_PATH = "/login";

function parentOf(pathname: string): string {
  return pathname.slice(0, pathname.lastIndexOf(SEPARATOR));
}

/** True when `next` is a page of the same builder as `current` (or its bare URL, which redirects there). */
export function isSameBuilder(current: string, next: string): boolean {
  const builder = parentOf(current);
  if (next === builder) return true;
  return parentOf(next) === builder && isBuilderSection(next.slice(next.lastIndexOf(SEPARATOR) + 1));
}

function useBeforeUnload(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return undefined;
    const hold = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [dirty]);
}

export interface LeaveGuardProps {
  /** Read at each navigation; the form keeps it equal to its dirty state. */
  dirtyRef: RefObject<boolean>;
  /** The dirty state of this render, for the beforeunload listener. */
  dirty: boolean;
}

export function LeaveGuard({ dirtyRef, dirty }: LeaveGuardProps) {
  useBeforeUnload(dirty);
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => dirtyRef.current && next.pathname !== LOGIN_PATH && !isSameBuilder(current.pathname, next.pathname),
    enableBeforeUnload: false,
    withResolver: true,
  });
  if (blocker.status !== "blocked") return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) blocker.reset();
      }}
      title={LEAVE_TEXT.title}
      description={LEAVE_TEXT.description}
    >
      <div className="flex flex-wrap gap-3">
        <Button variant="danger" onClick={() => blocker.proceed()}>
          {LEAVE_TEXT.leave}
        </Button>
        <Button variant="primary" onClick={() => blocker.reset()}>
          {LEAVE_TEXT.stay}
        </Button>
      </div>
    </Dialog>
  );
}
