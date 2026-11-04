/**
 * Study this spot (S46, R3.34, item 11): the reveal's link to the decision's node in Study, beside
 * Ask in the feedback's controls row. It opens in a new tab (target _blank, rel noopener) so the
 * trainer stays behind, and Shift+S, registered by the decision area in the session's scope, opens
 * the same link. The href comes from trainer/study-link.ts; it carries no panel state, so a study
 * link never turns a panel on.
 */
import { Button } from "../../components/ui/index.js";
import { displayBinding } from "../../hotkeys/index.js";
import { SESSION_TEXT, STUDY_SPOT_BINDING } from "./labels.js";

/** The new tab's name and features for window.open, the same as the link's target and rel. */
export const STUDY_TAB_TARGET = "_blank";
export const STUDY_TAB_FEATURES = "noopener";

export interface StudySpotLinkProps {
  href: string;
}

export function StudySpotLink({ href }: StudySpotLinkProps) {
  const chord = displayBinding(STUDY_SPOT_BINDING);
  return (
    <Button asChild variant="secondary" size="sm">
      <a href={href} target={STUDY_TAB_TARGET} rel={`${STUDY_TAB_FEATURES} noreferrer`} aria-keyshortcuts={chord}>
        <kbd aria-hidden="true" className="font-mono text-xs">
          {chord}
        </kbd>
        {SESSION_TEXT.studySpot}
      </a>
    </Button>
  );
}
