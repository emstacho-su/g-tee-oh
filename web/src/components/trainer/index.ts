/**
 * The trainer's decision components (S24, S25, S37, R3.10, R3.13): action bar, the Mixed-frequency
 * mode roll scale (hidden before the decision, revealed after it) and explainer, feedback with its
 * range view, threshold card and roller. The confidence tap and the roll badge were retired (O-345,
 * O-344). S38: the feedback panel is a summary with sections that expand and collapse (O-387).
 */
export { ActionBar, ACTION_SCOPE, MAX_HOTKEY_ACTIONS } from "./ActionBar.js";
export type { ActionBarProps } from "./ActionBar.js";
export { actionAccessibleName, actionButtonLabel } from "./action-labels.js";
export { KIND_KEYS, KIND_KEY_NAMES, MAX_SIZE_HOTKEYS, SIZE_KINDS, actionHotkeys } from "./action-keys.js";
export type { ActionButtonLabel } from "./action-labels.js";
export { ActionSwatch, ACTION_FILL_CLASSES, ACTION_INK_CLASSES, actionFillStyle } from "./ActionSwatch.js";
export type { ActionSwatchProps } from "./ActionSwatch.js";
export { RngRoller, ROLLER_TEXT, SCALE_TICKS } from "./RngRoller.js";
export type { HiddenRollerProps, RevealedRollerProps, RngRollerProps } from "./RngRoller.js";
export { FeedbackPanel } from "./FeedbackPanel.js";
export { GRADE_DEFINITIONS, GRADE_NAMES, GRADE_ORDER, GRADE_ROLL_NOTE, GRADE_TIP_SUBJECT, GradeTip } from "./grade-definitions.js";
export type { GradeTipProps } from "./grade-definitions.js";
export { solverFrequency, solverFrequencyShort, solverFrequencyText } from "./solver-frequency.js";
export type { SolverFrequency, SolverFrequencyEntry } from "./solver-frequency.js";
export type { FeedbackPanelProps } from "./FeedbackPanel.js";
export { FeedbackSummary, SUMMARY_TEXT, lossText } from "./FeedbackSummary.js";
export type { FeedbackSummaryProps } from "./FeedbackSummary.js";
export {
  FEEDBACK_SECTION_ORDER,
  FEEDBACK_SECTION_TITLES,
  defaultSectionOpen,
  resolveSectionOpen,
  useFeedbackSections,
} from "./feedback-sections.js";
export type { FeedbackOpenState, FeedbackSectionKey, FeedbackSectionsControl } from "./feedback-sections.js";
export { RngExplainer, RngExplainerContent } from "./RngExplainer.js";
export type { RngExplainerProps } from "./RngExplainer.js";
export { useRngExplainer } from "./use-rng-explainer.js";
export type { RngExplainerControl, UseRngExplainerOptions } from "./use-rng-explainer.js";
export { FeedbackRoller, FOLLOW_TEXT } from "./FeedbackRoller.js";
export type { FeedbackRollerProps } from "./FeedbackRoller.js";
export { FeedbackRangeView } from "./FeedbackRangeView.js";
export type { FeedbackRangeViewProps } from "./FeedbackRangeView.js";
export { FeedbackThreshold } from "./FeedbackThreshold.js";
export type { FeedbackThresholdProps } from "./FeedbackThreshold.js";
