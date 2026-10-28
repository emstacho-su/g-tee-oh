/**
 * The trainer's decision components (S24, S25, R3.10, R3.13): action bar, confidence tap, RNG
 * strip, roll badge and explainer, feedback with its range view, threshold card and roller.
 */
export { ActionBar, ACTION_SCOPE, MAX_HOTKEY_ACTIONS } from "./ActionBar.js";
export type { ActionBarProps } from "./ActionBar.js";
export { actionAccessibleName, actionButtonLabel } from "./action-labels.js";
export type { ActionButtonLabel } from "./action-labels.js";
export { ActionSwatch, ACTION_FILL_CLASSES, actionFillStyle } from "./ActionSwatch.js";
export type { ActionSwatchProps } from "./ActionSwatch.js";
export { ConfidenceTap, CONFIDENCE_SCOPE } from "./ConfidenceTap.js";
export type { ConfidenceChoice, ConfidenceTapProps } from "./ConfidenceTap.js";
export { RngRoller } from "./RngRoller.js";
export type { RngRollerProps } from "./RngRoller.js";
export { FeedbackPanel, LATER_SESSION_NOTE } from "./FeedbackPanel.js";
export type { FeedbackPanelProps } from "./FeedbackPanel.js";
export { RngExplainer, RngExplainerContent } from "./RngExplainer.js";
export type { RngExplainerProps } from "./RngExplainer.js";
export { useRngExplainer } from "./use-rng-explainer.js";
export type { RngExplainerControl, UseRngExplainerOptions } from "./use-rng-explainer.js";
export { RollBadge } from "./RollBadge.js";
export type { RollBadgeProps } from "./RollBadge.js";
export { FeedbackRoller } from "./FeedbackRoller.js";
export type { FeedbackRollerProps } from "./FeedbackRoller.js";
export { FeedbackRangeView } from "./FeedbackRangeView.js";
export type { FeedbackRangeViewProps } from "./FeedbackRangeView.js";
export { FeedbackThreshold } from "./FeedbackThreshold.js";
export type { FeedbackThresholdProps } from "./FeedbackThreshold.js";
