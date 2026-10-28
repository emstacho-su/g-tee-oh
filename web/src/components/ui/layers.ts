/**
 * The app's stacking layers (S36 review): one scale in styles.css (--layer-header, --layer-tooltip,
 * --layer-overlay, --layer-dialog, in that order), read through these classes so no component
 * picks its own z-index number. The sticky header sits below chart tooltips, and both sit below a
 * dialog's overlay and content, so no modal is ever painted over.
 */
export const HEADER_LAYER_CLASS = "z-(--layer-header)";
export const TOOLTIP_LAYER_CLASS = "z-(--layer-tooltip)";
export const OVERLAY_LAYER_CLASS = "z-(--layer-overlay)";
export const DIALOG_LAYER_CLASS = "z-(--layer-dialog)";
