/** The trainer's decision components (S24, R3.13): action bar, confidence tap, RNG strip, feedback. */
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
