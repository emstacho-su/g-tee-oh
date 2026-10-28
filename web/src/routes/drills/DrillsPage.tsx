/**
 * /drills: the drill library (S26, R3.14, A7 section 2, O-310, O-311; S40, O-404, screen review
 * row 41). The user's drills newest first in cursor pages (Load more), as a compact table
 * (DrillTable) whose rows are selectable, each with a settings gear to its builder; a toolbar that
 * acts on the selected drill (DrillToolbar); a tag filter held in ?tag= (TagFilter); New drill; and
 * Import a drill (ImportDialog). Nothing is selected at load and the selection is page state, not
 * the URL; a drill that leaves the list (deleted, filtered out) is no longer selected. A duplicate or
 * an import is announced in a polite live region; an imported drill appears at the top of the
 * table, and a tag filter it would not pass is cleared so it shows. With no drills there is an
 * empty state with a New drill link.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { describeFailureForLog } from "../../api/http-status.js";
import { useAppApi } from "../../auth/index.js";
import { Button, LoadingNote, PageHeader, Panel } from "../../components/ui/index.js";
import { drillFailureText } from "../../drills/failure-text.js";
import { drillListQuery } from "../../drills/queries.js";
import type { DrillsSearch } from "../../drills/search.js";
import type { Drill } from "../../drills/types.js";
import { DrillTable } from "./DrillTable.js";
import { DrillToolbar } from "./DrillToolbar.js";
import { IMPORT_TEXT, ImportDialog } from "./ImportDialog.js";
import { TagFilter } from "./TagFilter.js";

export interface DrillsPageProps {
  search: DrillsSearch;
}

export const LIBRARY_TEXT = {
  heading: "Drill library",
  description: "Select a drill to run, copy, export or delete it; the gear opens its settings.",
  newDrill: "New drill",
  loading: "Loading your drills",
  empty: "You have no drills yet. Build one, or import one from an export code.",
  emptyTagged: "No drill carries this tag.",
  more: "Load more drills",
} as const;

function NewDrillLink() {
  return (
    <Button asChild variant="primary">
      <Link to="/drills/new">{LIBRARY_TEXT.newDrill}</Link>
    </Button>
  );
}

function useTagNavigation(): (tag: string | undefined) => void {
  const navigate = useNavigate();
  return (tag) => {
    navigate({ to: "/drills", search: tag === undefined ? {} : { tag } }).catch((error: unknown) => {
      console.error(`g-tee-oh: the drill library navigation failed (${describeFailureForLog(error)})`);
    });
  };
}

function EmptyState({ tagged }: { tagged: boolean }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border-strong p-6">
      <p>{tagged ? LIBRARY_TEXT.emptyTagged : LIBRARY_TEXT.empty}</p>
      <NewDrillLink />
    </div>
  );
}

export function DrillsPage({ search }: DrillsPageProps) {
  const api = useAppApi();
  const list = useInfiniteQuery(drillListQuery(api, search.tag));
  const setTag = useTagNavigation();
  const [importing, setImporting] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const drills = list.data?.pages.flatMap((page) => page.items) ?? [];
  const selected = drills.find((drill) => drill.id === selectedId);

  function imported(drill: Drill): void {
    setImporting(false);
    setAnnouncement(`Imported ${drill.name}.`);
    if (search.tag !== undefined && !drill.tags.includes(search.tag)) setTag(undefined);
  }

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title={LIBRARY_TEXT.heading}
        description={LIBRARY_TEXT.description}
        actions={
          <>
            <NewDrillLink />
            <Button onClick={() => setImporting(true)}>{IMPORT_TEXT.open}</Button>
          </>
        }
      />
      <p role="status" data-testid="library-status" className="text-sm empty:hidden">
        {announcement}
      </p>
      <Panel>
        <TagFilter key={search.tag ?? ""} tag={search.tag} onFilter={(tag) => setTag(tag)} />
        {list.isError ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm">
            <p className="text-danger">{drillFailureText(list.error)}</p>
            <Button size="sm" onClick={() => void list.refetch()}>
              Try again
            </Button>
          </div>
        ) : null}
        {list.isPending ? <LoadingNote text={LIBRARY_TEXT.loading} /> : null}
        {list.isSuccess && drills.length === 0 ? <EmptyState tagged={search.tag !== undefined} /> : null}
        {drills.length === 0 ? null : (
          <>
            <DrillToolbar key={selected?.id ?? ""} api={api} drill={selected} onDuplicated={(copy) => setAnnouncement(`Duplicated as ${copy.name}.`)} />
            <DrillTable drills={drills} selectedId={selected?.id} onSelect={setSelectedId} />
          </>
        )}
        {list.hasNextPage ? (
          <Button className="self-start" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            {LIBRARY_TEXT.more}
          </Button>
        ) : null}
      </Panel>
      <ImportDialog api={api} open={importing} onOpenChange={setImporting} onImported={imported} />
    </section>
  );
}
