/**
 * /library: the coverage view and builder health (S28, R3.4, R3.5, A7 sections 2 and 3, O-36,
 * O-291, O-297, ADR 0018). Library-first serving made visible: what the library holds, what is
 * queued, and a way to ask for a gap that never waits on a solve.
 *
 * S40 (O-406, screen review rows 63 to 70): one container with a page per section, the /settings
 * pattern. The URL names the open page (/library/<section>, library/sections.ts); a "Library
 * sections" list beside the page on a wide screen, and as a scrolling row above it at phone width,
 * moves between them, and every link carries the coverage search so a selected pair survives the
 * move. Pages: Coverage (everyone), Builder state and Builder settings (admins; a member opening
 * their URL reads the admin note, and the api's 403 stays the control, O-290).
 *
 * Mechanism: the URL's validated search (library/search.ts) is the coverage page's state. Each page
 * reads only what it shows (PR #42 review round 1 H): the coverage page owns the catalog reads and
 * the coverage event stream with its live line; the builder state page opens its own stream for the
 * build in progress; the settings page reads the builder status only.
 */
import { Link } from "@tanstack/react-router";

import { useAppApi } from "../../auth/index.js";
import { NAV_PILL_LINK_PROPS, PageHeader, PillNav } from "../../components/ui/index.js";
import type { LibrarySearch } from "../../library/search.js";
import { visibleLibrarySections, type LibrarySectionSlug } from "../../library/sections.js";
import { useIsAdmin } from "../../library/use-builder.js";
import { BuilderSettingsPage, BuilderStatePage } from "./BuilderPanel.js";
import { CoveragePage } from "./CoveragePage.js";

export const LIBRARY_PAGE_TEXT = {
  title: "Library",
  description: "What the library holds, what is queued for the builder, and how the builder runs.",
  sections: "Library sections",
} as const;

export interface LibraryPageProps {
  /** The open page of the library container (S40, O-406). */
  section: LibrarySectionSlug;
  search: LibrarySearch;
}

function SectionNav({ isAdmin, search }: { isAdmin: boolean; search: LibrarySearch }) {
  return (
    <PillNav label={LIBRARY_PAGE_TEXT.sections} className="md:w-56 md:shrink-0">
      {visibleLibrarySections(isAdmin).map((entry) => (
        <li key={entry.slug} className="shrink-0">
          <Link to="/library/$section" params={{ section: entry.slug }} search={search} {...NAV_PILL_LINK_PROPS}>
            {entry.label}
          </Link>
        </li>
      ))}
    </PillNav>
  );
}

export function LibraryPage({ section, search }: LibraryPageProps) {
  const api = useAppApi();
  const isAdmin = useIsAdmin();
  return (
    <section className="flex flex-col gap-6">
      <PageHeader title={LIBRARY_PAGE_TEXT.title} description={LIBRARY_PAGE_TEXT.description} />
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <SectionNav isAdmin={isAdmin} search={search} />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {section === "coverage" ? <CoveragePage api={api} search={search} /> : null}
          {section === "builder" ? <BuilderStatePage api={api} isAdmin={isAdmin} /> : null}
          {section === "settings" ? <BuilderSettingsPage api={api} isAdmin={isAdmin} /> : null}
        </div>
      </div>
    </section>
  );
}
