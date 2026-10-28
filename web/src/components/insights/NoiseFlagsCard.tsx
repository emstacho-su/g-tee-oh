/**
 * The noise flags card of the feedback panel (S27 lane C, R3.18, 05 section 9). solver-query flags
 * a decision it cannot judge fairly (a near-even EV mix, a rare line, suit mixing); learning's
 * grade() then leaves the decision out of the rating while still grading it for feedback. The
 * card shows the flags as text chips (components/panels/NoiseFlags) with one plain sentence
 * saying so, and renders nothing for a decision without flags.
 */
import { useId } from "react";

import type { NoiseFlag } from "../../contracts.js";
import { NoiseFlags } from "../panels/NoiseFlags.js";

export const NOISE_FLAGS_SENTENCE = "This decision is graded for feedback but left out of your rating, because the spot is too close or too rare to score fairly.";

export interface NoiseFlagsCardProps {
  flags: readonly NoiseFlag[];
}

export function NoiseFlagsCard({ flags }: NoiseFlagsCardProps) {
  const titleId = useId();
  if (flags.length === 0) return null;
  return (
    <section
      data-testid="noise-flags-card"
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4 text-sm"
    >
      <h3 id={titleId} className="font-semibold">
        Noise flags
      </h3>
      <NoiseFlags flags={flags} />
      <p className="text-muted">{NOISE_FLAGS_SENTENCE}</p>
    </section>
  );
}
