/**
 * The roll shown before a decision in RNG mode (S25, R3.10, O-282): the number only, never the
 * bands, which are the hand's strategy. SCAFFOLD: Lane C implements it; the props are final.
 */
export interface RollBadgeProps {
  roll: number;
  onExplain: () => void;
}

export function RollBadge({ roll }: RollBadgeProps) {
  return <p data-testid="roll-badge">{`Roll ${roll}`}</p>;
}
