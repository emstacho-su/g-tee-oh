/**
 * The frame every progress card shares (S32, R4.12): since S36 it is the components/ui Card itself
 * (O-346), re-exported under the name the /progress screen and the home cards import, so the two
 * screens read as one system and the raised surface is defined in one place.
 */
export { Card as ProgressCard } from "../ui/index.js";
export type { CardProps as ProgressCardProps } from "../ui/index.js";
