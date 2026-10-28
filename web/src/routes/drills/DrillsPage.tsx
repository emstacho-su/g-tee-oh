/**
 * /drills: the drill library (S26, R3.14, A7 section 2, O-310, O-311). The user's drills newest
 * first in cursor pages (Load more), each with its spot summary, stop rule, tags and actions
 * (DrillRow); a tag filter held in ?tag= (TagFilter); New drill; and Import a drill
 * (ImportDialog). A duplicate or an import is announced in a polite live region; an imported
 * drill appears at the top of the list, and a tag filter it would not pass is cleared so it shows.
 * With no drills there is an empty state with a New drill link.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { describeFailureForLog } from "../../api/http-status.js";
import { useAppApi } from "../../auth/index.js";
import { Button, LoadingNote } from "../../components/ui/index.js";
import { drillFailureText } from "../../drills/failure-text.js";
import { drillListQuery } from "../../drills/queries.js";
import type { DrillsSearch } from "../../drills/search.js";
import type { Drill } from "../../drills/types.js";
import { DrillRow } from "./DrillRow.js";
import { IMPORT_TEXT, ImportDialog } from "./ImportDialog.js";
import { TagFilter } from "./TagFilter.js";

export interface DrillsPageProps {
  search: DrillsSearch;
}

export const LIBRARY_TEXT = {
  heading: "Drill library",
  newDrill: "New drill",
  loading: "Loading your drills",
  empty: "You have no drills yet. Build one, or import one from an export code.",
  emptyTagged: "No drill carries this tag.",
  more: "Load more drills",
} as const;

const PRIMARY_LINK = "inline-flex h-10 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-text hover:opacity-90";

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
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-6">
      <p>{tagged ? LIBRARY_TEXT.emptyTagged : LIBRARY_TEXT.empty}</p>
      <Link to="/drills/new" className={PRIMARY_LINK}>
        {LIBRARY_TEXT.newDrill}
      </Link>
    </div>
  );
}

export function DrillsPage({ search }: DrillsPageProps) {
  const api = useAppApi();
  const list = useInfiniteQuery(drillListQuery(api, search.tag));
  const setTag = useTagNavigation();
  const [importing, setImporting] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const drills = list.data?.pages.flatMap((page) => page.items) ?? [];

  function imported(drill: Drill): void {
    setImporting(false);
    setAnnouncement(`Imported ${drill.name}.`);
    if (search.tag !== undefined && !drill.tags.includes(search.tag)) setTag(undefined);
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{LIBRARY_TEXT.heading}</h1>
        <div className="flex gap-2">
          <Link to="/drills/new" className={PRIMARY_LINK}>
            {LIBRARY_TEXT.newDrill}
          </Link>
          <Button onClick={() => setImporting(true)}>{IMPORT_TEXT.open}</Button>
        </div>
      </div>
      <TagFilter key={search.tag ?? ""} tag={search.tag} onFilter={(tag) => setTag(tag)} />
      <p role="status" data-testid="library-status" className="text-sm">
        {announcement}
      </p>
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
        <ul aria-label="Drills" className="flex flex-col gap-3">
          {drills.map((drill) => (
            <DrillRow key={drill.id} api={api} drill={drill} onDuplicated={(copy) => setAnnouncement(`Duplicated as ${copy.name}.`)} />
          ))}
        </ul>
      )}
      {list.hasNextPage ? (
        <Button className="self-start" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          {LIBRARY_TEXT.more}
        </Button>
      ) : null}
      <ImportDialog api={api} open={importing} onOpenChange={setImporting} onImported={imported} />
    </section>
  );
}
