/**
 * One drill in the library (S26, R3.14, O-311): its name, spot summary, stop rule and tags (each
 * tag links to the library filtered by it), and its actions: Run (/drills/$id/run), Edit
 * (/drills/$id), Duplicate, Export (the export dialog) and Delete (after a confirm dialog). Each
 * action's accessible name carries the drill's name ("Run RFI boundary hands"), so a list of
 * drills never has two controls with one name. The row owns its duplicate and delete intents, so
 * one row's request never blocks another's; a delete a practice session blocks shows the 409's
 * in-use sentence in the row.
 */
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";

import type { AppApi } from "../../api/index.js";
import { Button, Dialog } from "../../components/ui/index.js";
import { drillFailureText } from "../../drills/failure-text.js";
import { STOP_RULE_LABELS } from "../../drills/labels.js";
import { spotSummary } from "../../drills/summary.js";
import type { Drill } from "../../drills/types.js";
import { useDeleteDrill, useDuplicateDrill } from "../../drills/use-drill-writes.js";
import { ExportDialog } from "./ExportDialog.js";

export interface DrillRowProps {
  api: AppApi;
  drill: Drill;
  onDuplicated: (copy: Drill) => void;
}

const LINK_CLASSES = "inline-flex h-8 items-center rounded-md border border-border bg-surface-raised px-2 text-sm font-medium hover:bg-surface-sunken";

function TagLinks({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return <p className="text-sm text-muted">No tags</p>;
  return (
    <ul aria-label="Tags" className="flex flex-wrap gap-1 text-sm">
      {tags.map((tag) => (
        <li key={tag}>
          <Link to="/drills" search={{ tag }} aria-label={`Show drills tagged ${tag}`} className="rounded-full border border-border px-2 hover:bg-surface-sunken">
            {`#${tag}`}
          </Link>
        </li>
      ))}
    </ul>
  );
}

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

export function DrillRow({ api, drill, onDuplicated }: DrillRowProps) {
  const headingId = useId();
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const duplicate = useDuplicateDrill(api, onDuplicated);
  const remove = useDeleteDrill(api);
  const failure = remove.error ?? duplicate.error;
  return (
    <li>
      <article aria-labelledby={headingId} data-testid="drill-row" className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4">
        <h2 id={headingId} className="text-lg font-semibold">
          {drill.name}
        </h2>
        <p data-testid="spot-summary" className="text-sm">
          {spotSummary(drill.spot_filter)}
        </p>
        <p className="text-sm text-muted">{`Stop rule: ${STOP_RULE_LABELS[drill.trainer.stop_rule]}`}</p>
        <TagLinks tags={drill.tags} />
        <div className="flex flex-wrap gap-2">
          <Link to="/drills/$id/run" params={{ id: drill.id }} aria-label={`Run ${drill.name}`} className={LINK_CLASSES}>
            Run
          </Link>
          <Link to="/drills/$id" params={{ id: drill.id }} aria-label={`Edit ${drill.name}`} className={LINK_CLASSES}>
            Edit
          </Link>
          <Button size="sm" aria-label={`Duplicate ${drill.name}`} disabled={duplicate.busy} onClick={() => duplicate.send(drill.id)}>
            Duplicate
          </Button>
          <Button size="sm" aria-label={`Export ${drill.name}`} onClick={() => setExporting(true)}>
            Export
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Delete ${drill.name}`} disabled={remove.busy} onClick={() => setConfirming(true)}>
            Delete
          </Button>
        </div>
        {failure === null || failure === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger">
            {`Error: ${drillFailureText(failure)}`}
          </p>
        )}
      </article>
      <ExportDialog api={api} drillId={drill.id} drillName={drill.name} open={exporting} onOpenChange={setExporting} />
      <ConfirmDelete
        name={drill.name}
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => {
          setConfirming(false);
          remove.send(drill.id);
        }}
      />
    </li>
  );
}
