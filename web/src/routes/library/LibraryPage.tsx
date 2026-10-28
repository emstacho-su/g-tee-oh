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
 * Mechanism: the URL's validated search (library/search.ts) is the coverage page's state. One
 * event stream is open while any library page is mounted (useLibraryEvents); its live line sits in
 * the page header and its build progress feeds the builder state page.
 */
import { Link } from "@tanstack/react-router";

import { useAppApi } from "../../auth/index.js";
import { NAV_PILL_LINK_PROPS, PageHeader, PillNav } from "../../components/ui/index.js";
import type { LibrarySearch } from "../../library/search.js";
import { visibleLibrarySections, type LibrarySectionSlug } from "../../library/sections.js";
import { useIsAdmin } from "../../library/use-builder.js";
import { useStudyCatalog } from "../../study/use-study-catalog.js";
import { BuilderSettingsPage, BuilderStatePage } from "./BuilderPanel.js";
import { CoveragePage } from "./CoveragePage.js";
import { LiveStatus } from "./LiveStatus.js";
import { useLibraryEvents } from "./use-library-events.js";

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
  const catalog = useStudyCatalog(api, search);
  const isAdmin = useIsAdmin();
  const events = useLibraryEvents(catalog.configId, search.pair);
  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title={LIBRARY_PAGE_TEXT.title}
        description={LIBRARY_PAGE_TEXT.description}
        actions={<LiveStatus status={events.status} onReconnect={events.reconnect} latest={events.latestCoverage} />}
      />
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <SectionNav isAdmin={isAdmin} search={search} />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {section === "coverage" ? <CoveragePage api={api} search={search} catalog={catalog} /> : null}
          {section === "builder" ? <BuilderStatePage api={api} isAdmin={isAdmin} progress={events.progress} /> : null}
          {section === "settings" ? <BuilderSettingsPage api={api} isAdmin={isAdmin} /> : null}
        </div>
      </div>
    </section>
  );
}
