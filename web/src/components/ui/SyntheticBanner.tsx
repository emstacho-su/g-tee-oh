/**
 * The synthetic data banner (S25, O-57, O-229, O-281): shown wherever the solution on screen is a
 * labeled synthetic fixture, with one wording in the study browser and the trainer. A note role
 * and a visible label, so color is never the only signal (A7 section 4).
 */
export const SYNTHETIC_TEXT = "Synthetic data: an illustrative fixture, not a solved spot.";

export function SyntheticBanner() {
  return (
    <p
      data-testid="synthetic-banner"
      role="note"
      className="rounded-md border border-warning bg-surface-sunken px-3 py-2 text-sm font-medium"
    >
      {SYNTHETIC_TEXT}
    </p>
  );
}
