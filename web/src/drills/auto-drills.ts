/**
 * Auto drills (S32, O-321; S47 follow-up, O-489): the drills /progress and the home queue create
 * for a leak carry a reserved tag, "auto-" plus a hash of the class (progress/open-drill.ts). The
 * library hides them until the user asks (Show auto drills), so the drills the user built or added
 * stay in front. Only the generated shape counts, so a tag of the user's own that starts with
 * "auto-" is never hidden (PR #51 review 3).
 */
import type { Drill } from "./types.js";

export const AUTO_TAG_PREFIX = "auto-";
/** How many hex characters of the class hash the tag keeps (open-drill.ts autoDrillTag). */
export const AUTO_TAG_HASH_CHARS = 26;
const AUTO_TAG_PATTERN = new RegExp(`^${AUTO_TAG_PREFIX}[0-9a-f]{${AUTO_TAG_HASH_CHARS}}$`);

export function isAutoTag(tag: string): boolean {
  return AUTO_TAG_PATTERN.test(tag);
}

export function isAutoDrill(drill: Pick<Drill, "tags">): boolean {
  return drill.tags.some(isAutoTag);
}
