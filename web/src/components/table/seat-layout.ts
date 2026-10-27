/**
 * Seat positions around the oval felt (S24, R3.13). Pure: seat i of n sits at an equal angle
 * step on an ellipse, rotated so the hero's seat is at the bottom center, and seats follow the
 * table clockwise from there. Positions are percentages of the table box, so the layout scales
 * with the container. Without a hero the first seat takes the bottom.
 */
export interface SeatSpot {
  readonly leftPercent: number;
  readonly topPercent: number;
}

const CENTER_PERCENT = 50;
/** Horizontal and vertical radii of the seat ellipse, in percent of the table box. */
const RADIUS_X_PERCENT = 44;
const RADIUS_Y_PERCENT = 40;
/** The bottom of the ellipse in screen coordinates (y grows downwards). */
const BOTTOM_RADIANS = Math.PI / 2;
const FULL_TURN_RADIANS = 2 * Math.PI;

export function seatLayout(count: number, heroIndex: number): SeatSpot[] {
  const anchor = heroIndex >= 0 && heroIndex < count ? heroIndex : 0;
  return Array.from({ length: count }, (_, index) => {
    const step = (index - anchor + count) % count;
    const angle = BOTTOM_RADIANS + (step * FULL_TURN_RADIANS) / count;
    return {
      leftPercent: CENTER_PERCENT + RADIUS_X_PERCENT * Math.cos(angle),
      topPercent: CENTER_PERCENT + RADIUS_Y_PERCENT * Math.sin(angle),
    };
  });
}
