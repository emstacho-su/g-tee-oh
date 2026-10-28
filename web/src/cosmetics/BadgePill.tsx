/**
 * An equipped badge shown as a small pill (S32, R4.14, O-279): the badge's plain label from the
 * catalog beside a star glyph, so the badge reads as text, never as color alone. The home rating
 * card puts it in its badge slot and /settings uses it as the badge preview.
 */
import { describeCosmetic } from "./catalog.js";

export interface BadgePillProps {
  cosmeticKey: string;
}

export function BadgePill({ cosmeticKey }: BadgePillProps) {
  return (
    <span
      data-testid="badge-pill"
      className="inline-flex items-center gap-1 rounded-full border border-accent px-2 py-0.5 text-xs font-semibold text-text"
    >
      <span aria-hidden="true">★</span>
      {describeCosmetic(cosmeticKey)}
    </span>
  );
}
