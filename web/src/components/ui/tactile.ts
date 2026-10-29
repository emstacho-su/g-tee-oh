/**
 * The class names of the Tactile Digital utilities in src/styles.css (S36, O-346, O-364). Every
 * pressable primitive adds TACTILE_CLASS and every card or panel RAISED_CLASS, so the depth and the
 * press-squish live in one place and no screen keeps its own copy.
 */
export const TACTILE_CLASS = "tactile";
export const RAISED_CLASS = "raised";
/** Drops the resting shadow of a flat control (the ghost button) while keeping its press. */
export const FLAT_REST_CLASS = "[--tactile-rest:none]";
/**
 * The edge of a control (WCAG 1.4.11, S36 review): the strong border token at full opacity, the
 * one the contrast gate checks at 3:1 on every ground. Decorative edges (cards, panels) keep
 * --border; a control never does, and a source scan test holds every field to this class.
 */
export const CONTROL_EDGE_CLASS = "border border-border-strong";
/**
 * A focus mark drawn inside a fill (the marked roll band, S43, O-432): the focus outline on the
 * fill's inner edge and, in dark, a 4 px inset halo of --focus-halo under it, so the near-white ring
 * or the dark halo reaches 3:1 on any action fill (the contrast gate checks every one). The outline
 * paints over the inset shadow, leaving a 2 px halo line inside the ring.
 */
export const FOCUS_MARK_CLASS = "outline outline-2 -outline-offset-2 outline-focus dark:shadow-[inset_0_0_0_4px_var(--focus-halo)]";
/** A text field, select or textarea: the control edge on the raised surface. */
export const FIELD_CLASS = `${CONTROL_EDGE_CLASS} rounded-lg bg-surface-raised text-text`;
