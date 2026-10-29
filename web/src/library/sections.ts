/**
 * The pages of the /library container (S40, R3.4, R3.5, O-406, screen review rows 63 to 70). Each
 * page lives at /library/<slug>; /library itself and any slug not listed here go to
 * DEFAULT_LIBRARY_SECTION, keeping the coverage search. The builder state and settings pages are
 * listed for admins only; a member opening either URL reads the admin note (as O-361), and the
 * api's admin check stays the control.
 */
export const LIBRARY_SECTIONS = [
  { slug: "coverage", label: "Coverage", adminOnly: false },
  { slug: "builder", label: "Builder state", adminOnly: true },
  { slug: "settings", label: "Builder settings", adminOnly: true },
] as const;

export type LibrarySectionSlug = (typeof LIBRARY_SECTIONS)[number]["slug"];
export type LibrarySectionEntry = (typeof LIBRARY_SECTIONS)[number];

export const DEFAULT_LIBRARY_SECTION: LibrarySectionSlug = "coverage";

const SLUGS: ReadonlySet<string> = new Set(LIBRARY_SECTIONS.map((section) => section.slug));

/** True when the path segment names a library page (the URL is untrusted input). */
export function isLibrarySection(value: unknown): value is LibrarySectionSlug {
  return typeof value === "string" && SLUGS.has(value);
}

/** The pages a viewer sees in the section list: every page, less the admin pages for a member. */
export function visibleLibrarySections(isAdmin: boolean): readonly LibrarySectionEntry[] {
  return LIBRARY_SECTIONS.filter((section) => isAdmin || !section.adminOnly);
}
