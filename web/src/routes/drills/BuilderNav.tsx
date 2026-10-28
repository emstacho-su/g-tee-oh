/**
 * The builder's section list (S40, R3.14, O-405): the shared PillNav, one link per builder page of
 * the same drill (or of the new drill), beside the page at md and a scrolling row at phone width,
 * as /settings does. A page that holds a field error after Save carries a visible "needs a fix"
 * marker that is also in the link's accessible name ("Seats, needs a fix"), so the marker is never
 * colour alone. Moving between these links keeps the one draft (the form stays mounted).
 */
import { Link } from "@tanstack/react-router";

import { NAV_PILL_LINK_PROPS, PillNav } from "../../components/ui/index.js";
import { BUILDER_SECTIONS, type BuilderSectionEntry, type BuilderSectionSlug } from "../../drills/builder-sections.js";

export const BUILDER_NAV_TEXT = {
  label: "Drill sections",
  needsFix: "needs a fix",
} as const;

export type SectionErrorCounts = Readonly<Partial<Record<BuilderSectionSlug, number>>>;

export interface BuilderNavProps {
  /** The stored drill; undefined for the new drill. */
  drillId: string | undefined;
  counts: SectionErrorCounts;
}

function LinkContent({ section, marked }: { section: BuilderSectionEntry; marked: boolean }) {
  if (!marked) return <>{section.label}</>;
  return (
    <span className="inline-flex items-center gap-2">
      <span>{section.label}</span>
      <span className="rounded-full border border-danger px-1.5 text-xs font-semibold text-danger">{BUILDER_NAV_TEXT.needsFix}</span>
    </span>
  );
}

/** The link to one builder page; the props of a marked link carry the marker in its name. */
export function SectionLink({ drillId, section, marked }: { drillId: string | undefined; section: BuilderSectionEntry; marked: boolean }) {
  const label = marked ? { "aria-label": `${section.label}, ${BUILDER_NAV_TEXT.needsFix}` } : {};
  const content = <LinkContent section={section} marked={marked} />;
  if (drillId === undefined) {
    return (
      <Link to="/drills/new/$section" params={{ section: section.slug }} {...label} {...NAV_PILL_LINK_PROPS}>
        {content}
      </Link>
    );
  }
  return (
    <Link to="/drills/$id/$section" params={{ id: drillId, section: section.slug }} {...label} {...NAV_PILL_LINK_PROPS}>
      {content}
    </Link>
  );
}

export function BuilderNav({ drillId, counts }: BuilderNavProps) {
  return (
    <PillNav label={BUILDER_NAV_TEXT.label} className="md:w-56 md:shrink-0">
      {BUILDER_SECTIONS.map((section) => (
        <li key={section.slug} className="shrink-0">
          <SectionLink drillId={drillId} section={section} marked={(counts[section.slug] ?? 0) > 0} />
        </li>
      ))}
    </PillNav>
  );
}
