/**
 * The feedback panel shown after a decision (S24, S25, S27, S38, S46, R3.13, A7, O-387, O-388,
 * ADR 0024).
 *
 * The owner's review: show "a condensed set of what is actually relevant and let the user drill
 * down", with sections that "just expand and collapse" rather than a pop-out to exit. So the panel
 * is a short summary (FeedbackSummary: the label with its definitions tip, your action against the
 * best, the loss and the solver's frequency, Unrated with its reason, the roll), then the controls
 * row the caller gives (Ask, Study this spot) directly under it so the controls are reached
 * without scrolling past the open sections (S46, critic round 3 R10), and under that one Disclosure
 * per section the caller gives: Roll (the roll scale with its followed-the-roll mark, S37),
 * Strategy (the hand's frequency and EV per action, best actions marked Best), Range, Where your
 * hand sits (the threshold card), Insights (noise flags and drift, S27) and Explanation (More
 * info's template sections, S27; the Explanation disclosure is the only way into More info since
 * S46). A section whose slot is absent has no button; Strategy always exists. Defaults and the
 * remembered choices follow feedback-sections.ts (O-387): Strategy starts open on a worked example
 * and on an inaccuracy, a mistake or a blunder (S46); sections mount on their first open, so the
 * range, threshold, drift and More info reads run only when wanted.
 *
 * Numbering (O-198): chosenIndex and feedback.best_action_indexes are NodeAction.index values,
 * never positions in actions; freq_by_action and ev_by_action are positional, as the contract
 * defines them. A chosen index that names no action renders an alert instead of the panel.
 */
import type { ReactNode } from "react";

import { Disclosure, RAISED_CLASS, cn } from "../ui/index.js";
import type { DecisionFeedback, NodeAction } from "../../contracts.js";
import { actionOfIndex } from "../../poker/action-index.js";
import { ActionFrequencyTable } from "../panels/ActionFrequencyTable.js";
import {
  FEEDBACK_SECTION_ORDER,
  FEEDBACK_SECTION_TITLES,
  resolveSectionOpen,
  useFeedbackSections,
  type FeedbackOpenState,
  type FeedbackSectionKey,
  type FeedbackSectionsControl,
} from "./feedback-sections.js";
import { FeedbackSummary } from "./FeedbackSummary.js";

export interface FeedbackPanelProps {
  feedback: DecisionFeedback;
  actions: readonly NodeAction[];
  /** The NodeAction.index the hero chose (O-198), not a position in actions. */
  chosenIndex: number;
  /** Why the decision is unrated (trainer/unrated-reason.ts), shown beside the Unrated chip. */
  unratedReason?: string | null;
  /** The Range section's body. */
  rangeView?: ReactNode;
  /** The Where your hand sits section's body. */
  thresholdCard?: ReactNode;
  /** The Roll section's body: the roller after the reveal, in Mixed-frequency mode (S25, S37). */
  roller?: ReactNode;
  /** The Insights section's body: noise flags and range drift (S27, R3.18, O-304). */
  insights?: ReactNode;
  /** The Explanation section's body: More info's template sections (S27, R3.19, O-388). */
  explanation?: ReactNode;
  /** The controls row under the summary (S27: Ask with its dialog; S46: Study this spot). */
  explain?: ReactNode;
  /** The prompt was a worked example: Strategy starts open (O-387, O-272). */
  workedExample?: boolean;
  /** The session's remembered section choices (useFeedbackSections); the panel keeps its own without. */
  sections?: FeedbackSectionsControl;
  /** Sections to open by default, over the built-in defaults (the gallery's expanded view). */
  defaultOpen?: FeedbackOpenState;
}

const STRATEGY_CAPTION = "This hand's strategy";

/** Each section's body, or undefined when the caller gave none (Strategy always has one). */
function sectionBodies(props: FeedbackPanelProps): Readonly<Record<FeedbackSectionKey, ReactNode | undefined>> {
  const { feedback, actions } = props;
  return {
    roll: props.roller,
    strategy: (
      <ActionFrequencyTable
        actions={actions}
        frequencies={feedback.freq_by_action}
        evBb={feedback.ev_by_action}
        highlightIndexes={feedback.best_action_indexes}
        caption={STRATEGY_CAPTION}
      />
    ),
    range: props.rangeView,
    threshold: props.thresholdCard,
    insights: props.insights,
    explanation: props.explanation,
  };
}

export function FeedbackPanel(props: FeedbackPanelProps) {
  const { feedback, actions, chosenIndex, unratedReason = null, explain, workedExample = false, sections, defaultOpen } = props;
  const own = useFeedbackSections(null);
  const control = sections ?? own;
  const chosen = actionOfIndex(actions, chosenIndex);
  if (chosen === undefined) {
    return (
      <p role="alert" data-testid="feedback-panel" className="text-danger">
        {`The chosen action ${chosenIndex} is not one of this node's ${actions.length} actions.`}
      </p>
    );
  }
  const bodies = sectionBodies(props);
  const defaults = { workedExample, label: feedback.label };
  return (
    <section
      data-testid="feedback-panel"
      aria-label="Decision feedback"
      className={cn("flex w-full min-w-0 max-w-md flex-col gap-3 rounded-2xl border border-border/50 bg-surface-raised p-3 sm:p-4", RAISED_CLASS)}
    >
      <FeedbackSummary feedback={feedback} actions={actions} chosen={chosen} unratedReason={unratedReason} />
      {explain === undefined ? null : explain}
      <div className="flex flex-col gap-2">
        {FEEDBACK_SECTION_ORDER.map((key) => {
          const body = bodies[key];
          if (body === undefined || body === null) return null;
          return (
            <Disclosure
              key={key}
              title={FEEDBACK_SECTION_TITLES[key]}
              testId={`feedback-section-${key}`}
              open={resolveSectionOpen(key, control.open, defaultOpen, defaults)}
              onOpenChange={(open) => control.setOpen(key, open)}
            >
              <div className="pt-1">{body}</div>
            </Disclosure>
          );
        })}
      </div>
    </section>
  );
}
