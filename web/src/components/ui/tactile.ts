/**
 * The class names of the Tactile Digital utilities in src/styles.css (S36, O-346, O-364). Every
 * pressable primitive adds TACTILE_CLASS and every card or panel RAISED_CLASS, so the depth and the
 * press-squish live in one place and no screen keeps its own copy.
 */
export const TACTILE_CLASS = "tactile";
export const RAISED_CLASS = "raised";
/** Drops the resting shadow of a flat control (the ghost button) while keeping its press. */
export const FLAT_REST_CLASS = "[--tactile-rest:none]";
