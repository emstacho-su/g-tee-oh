/**
 * Noise flag chips (S25 study notices, moved here by S27 for the feedback panel too; R3.12,
 * R3.18, 05 section 9). Each flag solver-query raised on a node or a graded hand renders as a text
 * chip with its readable name, so color is never the only signal (A7 section 4). The study screen
 * (routes/study/StudyNotices.tsx re-exports this) and the feedback insight cards share it.
 */
import type { NoiseFlag } from "../../contracts.js";

/** The readable name of each flag solver-query can raise. */
export const NOISE_FLAG_TEXT: Readonly<Record<NoiseFlag, string>> = {
  close_ev_mix: "Close EV mix",
  rare_line: "Rare line",
  suit_mixing: "Suit mixing",
};

export interface NoiseFlagsProps {
  flags: readonly NoiseFlag[];
}

export function NoiseFlags({ flags }: NoiseFlagsProps) {
  if (flags.length === 0) return null;
  return (
    <ul aria-label="Noise flags" className="flex flex-wrap gap-2 text-xs">
      {flags.map((flag) => (
        <li key={flag} className="rounded border border-border bg-surface-sunken px-2 py-0.5">
          {NOISE_FLAG_TEXT[flag]}
        </li>
      ))}
    </ul>
  );
}
