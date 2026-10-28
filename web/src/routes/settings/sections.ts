/**
 * The pages of the /settings container (S36, R4.12, O-348, O-360, O-361). Each page lives at
 * /settings/<slug>; /settings itself and any slug not listed here go to DEFAULT_SETTINGS_SECTION.
 * The builder schedule is listed for admins only; a member opening its URL reads a note instead.
 */
export const SETTINGS_SECTIONS = [
  { slug: "session-defaults", label: "Session defaults", adminOnly: false },
  { slug: "configurations", label: "Configuration scope", adminOnly: false },
  { slug: "hotkeys", label: "Hotkeys", adminOnly: false },
  { slug: "cosmetics", label: "Cosmetics", adminOnly: false },
  { slug: "builder-schedule", label: "Builder schedule", adminOnly: true },
] as const;

export type SettingsSectionSlug = (typeof SETTINGS_SECTIONS)[number]["slug"];
export type SettingsSectionEntry = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionSlug = "session-defaults";

const SLUGS: ReadonlySet<string> = new Set(SETTINGS_SECTIONS.map((section) => section.slug));

/** True when the path segment names a settings page (the URL is untrusted input). */
export function isSettingsSection(value: unknown): value is SettingsSectionSlug {
  return typeof value === "string" && SLUGS.has(value);
}

/** The pages a viewer sees in the section list: every page, less the admin pages for a member. */
export function visibleSections(isAdmin: boolean): readonly SettingsSectionEntry[] {
  return SETTINGS_SECTIONS.filter((section) => isAdmin || !section.adminOnly);
}
