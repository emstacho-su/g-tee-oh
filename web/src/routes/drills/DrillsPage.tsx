/**
 * /drills: the drill library (S26, R3.14, A7 section 2, O-310, O-311; S40, O-404, screen review
 * row 41). The user's drills newest first in cursor pages (Load more), as a compact table
 * (DrillTable) whose rows are selectable, each with a settings gear to its builder; a toolbar that
 * acts on the selected drill (DrillToolbar); a tag filter held in ?tag= (TagFilter); New drill; and
 * Import a drill (ImportDialog). Nothing is selected at load and the selection is page state, not
 * the URL; a drill that leaves the list (deleted, filtered out) is no longer selected. A duplicate or
 * an import is announced in a polite live region; an imported drill appears at the top of the
 * table, and a tag filter it would not pass is cleared so it shows. With no drills there is an
 * empty state offering the starter pack (S47, R3.35, O-481) and a New drill link; the header offers
 * the starter drills the user does not have yet (its own read of the starter tag, taggedMarksQuery),
 * so a pack that landed partway offers only the rest. Both buttons share the page's one intent. The duplicate and delete requests belong to this page, so a
 * change of selection while one runs never drops its result; a failure shows with the drill it
 * acted on whenever that drill is selected (PR #42 review round 1 C). Auto drills, the ones /progress
 * makes for a leak, are hidden behind "Show auto drills" (S47 follow-up, O-489, page state), unless
 * the tag filter names an auto tag; a drill just imported or the selected one is never hidden, the
 * count is of the drills loaded so far, and a library of auto drills only keeps the empty state
 * (PR #51 review 4).
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { describeFailureForLog } from "../../api/http-status.js";
import { isAutoDrill, isAutoTag } from "../../drills/auto-drills.js";
import { useAppApi } from "../../auth/index.js";
import { Button, LoadingNote, PageHeader, Panel } from "../../components/ui/index.js";
import { drillFailureText } from "../../drills/failure-text.js";
import { drillListQuery, taggedMarksQuery } from "../../drills/queries.js";
import type { DrillsSearch } from "../../drills/search.js";
import { missingStarterDrills, STARTER_PACK, STARTER_TAG, type StarterDrill } from "../../drills/starter-pack.js";
import type { Drill } from "../../drills/types.js";
import { useDeleteDrill, useDuplicateDrill, useImportStarterPack } from "../../drills/use-drill-writes.js";
import type { IntentMutation } from "../../library/use-intent-mutation.js";
import { DrillTable } from "./DrillTable.js";
import { DrillToolbar } from "./DrillToolbar.js";
import { IMPORT_TEXT, ImportDialog } from "./ImportDialog.js";
import { STARTER_TEXT, StarterPackButton, type StarterPackIntent } from "./StarterPackButton.js";
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
  showAuto: "Show auto drills",
  autoHidden: (hidden: number, loaded: number) =>
    `${hidden} of the ${loaded} ${loaded === 1 ? "drill" : "drills"} loaded ${hidden === 1 ? "is an auto drill" : "are auto drills"} from your leaks, hidden.`,
} as const;

interface AutoDrillsToggleProps {
  checked: boolean;
  hidden: number;
  loaded: number;
  onChange: (checked: boolean) => void;
}

function AutoDrillsToggle({ checked, hidden, loaded, onChange }: AutoDrillsToggleProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        {LIBRARY_TEXT.showAuto}
      </label>
      {checked || hidden === 0 ? null : (
        <span data-testid="auto-drills-hidden" className="text-muted">
          {LIBRARY_TEXT.autoHidden(hidden, loaded)}
        </span>
      )}
    </div>
  );
}

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

/** The request's failure when its latest run acted on this drill (review round 1 C). */
function failureOn<TResult>(request: IntentMutation<string, TResult>, drillId: string): unknown {
  return request.input === drillId && !request.busy ? request.error : null;
}

interface EmptyStateProps {
  tagged: boolean;
  pack: StarterPackIntent;
  missing: readonly StarterDrill[];
}

/** No drills yet: the starter pack first (S47, R3.35, O-481), then New drill. */
function EmptyState({ tagged, pack, missing }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border-strong p-6">
      <p>{tagged ? LIBRARY_TEXT.emptyTagged : LIBRARY_TEXT.empty}</p>
      {tagged || missing.length === 0 ? null : <StarterPackButton pack={pack} missing={missing} withHint />}
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
  const [showAuto, setShowAuto] = useState(false);
  // Drills imported on this page: shown whatever the auto toggle says (PR #51 review 4).
  const [importedIds, setImportedIds] = useState<ReadonlySet<string>>(new Set());
  const listed = list.data?.pages.flatMap((page) => page.items) ?? [];
  // Auto drills stay hidden until asked for, or when the filter names an auto tag (O-489).
  const autoTagFilter = search.tag !== undefined && isAutoTag(search.tag);
  const autoShown = showAuto || autoTagFilter;
  const autoCount = listed.filter(isAutoDrill).length;
  const drills = autoShown ? listed : listed.filter((drill) => !isAutoDrill(drill) || importedIds.has(drill.id) || drill.id === selectedId);
  const selected = drills.find((drill) => drill.id === selectedId);
  // The requests live here, not in the toolbar, so a change of selection never drops their result.
  const duplicate = useDuplicateDrill(api, (copy) => setAnnouncement(`Duplicated as ${copy.name}.`));
  const remove = useDeleteDrill(api);
  const failure = selected === undefined ? null : (failureOn(remove, selected.id) ?? failureOn(duplicate, selected.id));
  // The header offers the pack until the user has a starter drill, read on its own so a tag filter
  // or a later page never decides it (O-481, PR #48 review HIGH 3); the empty state always offers it.
  const starterMarks = useQuery(taggedMarksQuery(api, STARTER_TAG));
  // The pack entries the user does not have yet (round 2 MEDIUM 3); the whole pack until the read lands.
  const missing = starterMarks.data === undefined ? STARTER_PACK : missingStarterDrills(starterMarks.data);
  const starterAdded = (added: readonly Drill[]): void => {
    setAnnouncement(STARTER_TEXT.added(added.length));
    if (search.tag !== undefined) setTag(undefined);
  };
  // One intent for the page (review HIGH 2): every button over it shares one key set. A pack that
  // failed partway announces what landed and keeps the user's tag filter (code review round 1, 5).
  const pack = useImportStarterPack(api, { onImported: starterAdded, onPartial: (added) => setAnnouncement(STARTER_TEXT.added(added.length)) });
  const emptyUntagged = list.isSuccess && drills.length === 0 && search.tag === undefined;
  const offerInHeader = starterMarks.data !== undefined && missing.length > 0;

  function imported(drill: Drill): void {
    setImporting(false);
    setImportedIds((current) => new Set([...current, drill.id]));
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
            {offerInHeader ? <StarterPackButton pack={pack} missing={missing} showFailure={!emptyUntagged} /> : null}
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
        {list.isSuccess && drills.length === 0 ? <EmptyState tagged={search.tag !== undefined} pack={pack} missing={missing} /> : null}
        {autoCount > 0 && !autoTagFilter ? <AutoDrillsToggle checked={showAuto} hidden={listed.length - drills.length} loaded={listed.length} onChange={setShowAuto} /> : null}
        {drills.length === 0 ? null : (
          <>
            <DrillToolbar
              key={selected?.id ?? ""}
              api={api}
              drill={selected}
              duplicating={duplicate.busy}
              deleting={remove.busy}
              failure={failure}
              onDuplicate={(drill) => duplicate.send(drill.id)}
              onDelete={(drill) => remove.send(drill.id)}
            />
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
