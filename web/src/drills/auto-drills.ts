/**
 * Auto drills (S32, O-321; S47 follow-up, O-489): the drills /progress and the home queue create
 * for a leak carry a reserved tag, "auto-" plus a hash of the class (progress/open-drill.ts). The
 * library hides them until the user asks (Show auto drills), so the drills the user built or added
 * stay in front.
 */
import type { Drill } from "./types.js";

export const AUTO_TAG_PREFIX = "auto-";

export function isAutoTag(tag: string): boolean {
  return tag.startsWith(AUTO_TAG_PREFIX);
}

export function isAutoDrill(drill: Pick<Drill, "tags">): boolean {
  return drill.tags.some(isAutoTag);
}
