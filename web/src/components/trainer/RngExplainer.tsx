/**
 * The RNG (random number generator) mode explainer (S25, R3.10, 05 section 7, ADR 0009, O-283).
 * SCAFFOLD: Lane C replaces this body with the three-part explainer; the props are final.
 */
export interface RngExplainerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RngExplainer({ open }: RngExplainerProps) {
  return open ? <div data-testid="rng-explainer-stub" /> : null;
}
