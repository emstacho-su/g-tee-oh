/**
 * The app's stacking layers (S36 review and follow-up): one scale in styles.css, read through
 * these classes so no component picks its own z-index number (a source scan test holds every
 * component to it). In order: sticky headers inside a scrolling grid (the heat map's pair column),
 * the sticky app header, chart tooltips, then a dialog's overlay and its content, so no modal is
 * ever painted over.
 */
export const STICKY_LAYER_CLASS = "z-(--layer-sticky)";
export const HEADER_LAYER_CLASS = "z-(--layer-header)";
export const TOOLTIP_LAYER_CLASS = "z-(--layer-tooltip)";
export const OVERLAY_LAYER_CLASS = "z-(--layer-overlay)";
export const DIALOG_LAYER_CLASS = "z-(--layer-dialog)";
