/**
 * The drill library's selection toolbar (S40, R3.14, O-311, O-404): it names the selected drill and
 * acts on it: Run (/drills/$id/run), Duplicate, Export (the export dialog) and Delete (after a
 * confirm dialog). With nothing selected it says to choose a drill and its actions are off. Each
 * action's accessible name carries the drill's name ("Run RFI boundary hands"). The duplicate and
 * delete requests belong to the page, not to the toolbar (PR #42 review round 1 C): a request runs
 * to its end whatever is selected meanwhile, and its failure is shown, naming the drill, whenever
 * the drill it acted on is selected (the page passes it as `failure`). A delete a practice session
 * blocks shows the 409's in-use sentence that way.
 */
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { AppApi } from "../../api/index.js";
import { Button, Dialog } from "../../components/ui/index.js";
import { drillFailureText } from "../../drills/failure-text.js";
import type { Drill } from "../../drills/types.js";
import { ExportDialog } from "./ExportDialog.js";

export const TOOLBAR_TEXT = {
  label: "Selected drill",
  none: "Choose a drill in the table.",
  selected: (name: string) => `Selected: ${name}`,
  run: "Run",
  duplicate: "Duplicate",
  export: "Export",
  remove: "Delete",
} as const;

export interface DrillToolbarProps {
  api: AppApi;
  drill: Drill | undefined;
  /** The page's duplicate request is running (for any drill). */
  duplicating: boolean;
  /** The page's delete request is running (for any drill). */
  deleting: boolean;
  /** The failure of the latest request that acted on this drill, or null. */
  failure: unknown;
  onDuplicate: (drill: Drill) => void;
  onDelete: (drill: Drill) => void;
}

const TOOLBAR_CLASSES = "flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-surface-sunken px-3 py-2";

interface ConfirmDeleteProps {
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

function ConfirmDelete({ name, open, onOpenChange, onConfirm }: ConfirmDeleteProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Delete this drill?" description={`${name} is removed from your library. This cannot be undone.`}>
      <div className="flex gap-3">
        <Button variant="danger" onClick={onConfirm}>
          Delete
        </Button>
        <Button onClick={() => onOpenChange(false)}>Keep it</Button>
      </div>
    </Dialog>
  );
}

function EmptyToolbar() {
  return (
    <div role="group" aria-label={TOOLBAR_TEXT.label} className={TOOLBAR_CLASSES}>
      <p className="mr-auto text-sm text-muted">{TOOLBAR_TEXT.none}</p>
      {[TOOLBAR_TEXT.run, TOOLBAR_TEXT.duplicate, TOOLBAR_TEXT.export, TOOLBAR_TEXT.remove].map((label) => (
        <Button key={label} size="sm" disabled>
          {label}
        </Button>
      ))}
    </div>
  );
}

function SelectedToolbar({ api, drill, duplicating, deleting, failure, onDuplicate, onDelete }: DrillToolbarProps & { drill: Drill }) {
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <div role="group" aria-label={TOOLBAR_TEXT.label} className={TOOLBAR_CLASSES}>
      <p className="mr-auto text-sm font-semibold">{TOOLBAR_TEXT.selected(drill.name)}</p>
      <Button asChild size="sm" variant="primary">
        <Link to="/drills/$id/run" params={{ id: drill.id }} aria-label={`Run ${drill.name}`}>
          {TOOLBAR_TEXT.run}
        </Link>
      </Button>
      <Button size="sm" aria-label={`Duplicate ${drill.name}`} disabled={duplicating} onClick={() => onDuplicate(drill)}>
        {TOOLBAR_TEXT.duplicate}
      </Button>
      <Button size="sm" aria-label={`Export ${drill.name}`} onClick={() => setExporting(true)}>
        {TOOLBAR_TEXT.export}
      </Button>
      <Button size="sm" variant="ghost" aria-label={`Delete ${drill.name}`} disabled={deleting} onClick={() => setConfirming(true)}>
        {TOOLBAR_TEXT.remove}
      </Button>
      {failure === null || failure === undefined ? null : (
        <p role="alert" className="basis-full text-sm font-medium text-danger">
          {`Error: ${drill.name}: ${drillFailureText(failure)}`}
        </p>
      )}
      <ExportDialog api={api} drillId={drill.id} drillName={drill.name} open={exporting} onOpenChange={setExporting} />
      <ConfirmDelete
        name={drill.name}
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => {
          setConfirming(false);
          onDelete(drill);
        }}
      />
    </div>
  );
}

export function DrillToolbar(props: DrillToolbarProps) {
  if (props.drill === undefined) return <EmptyToolbar />;
  return <SelectedToolbar {...props} drill={props.drill} />;
}
