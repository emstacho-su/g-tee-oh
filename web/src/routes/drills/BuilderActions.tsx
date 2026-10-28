/**
 * The actions an existing drill's builder offers besides Save (S26, R3.14, O-311): Run
 * (/drills/$id/run), Export (the export dialog) and Duplicate (a copy named "<name> (copy)",
 * announced with a link to its builder). They act on the drill as stored, not on unsaved edits.
 */
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { AppApi } from "../../api/index.js";
import { Button } from "../../components/ui/index.js";
import { drillFailureText } from "../../drills/failure-text.js";
import type { Drill } from "../../drills/types.js";
import { useDuplicateDrill } from "../../drills/use-drill-writes.js";
import { ExportDialog } from "./ExportDialog.js";

export interface BuilderActionsProps {
  api: AppApi;
  drill: Drill;
}

const LINK_CLASSES = "inline-flex h-10 items-center rounded-md border border-border bg-surface-raised px-3 text-sm font-medium hover:bg-surface-sunken";

export function BuilderActions({ api, drill }: BuilderActionsProps) {
  const [exporting, setExporting] = useState(false);
  const duplicate = useDuplicateDrill(api);
  const copy = duplicate.result;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Link to="/drills/$id/run" params={{ id: drill.id }} className={LINK_CLASSES}>
          Run
        </Link>
        <Button onClick={() => setExporting(true)}>Export</Button>
        <Button disabled={duplicate.busy} onClick={() => duplicate.send(drill.id)}>
          Duplicate
        </Button>
      </div>
      <div role="status" className="text-sm">
        {copy === undefined ? null : (
          <p>
            {`Duplicated as ${copy.name}. `}
            <Link to="/drills/$id" params={{ id: copy.id }} className="underline">
              Open the copy
            </Link>
          </p>
        )}
      </div>
      {duplicate.error === null || duplicate.error === undefined ? null : (
        <p role="alert" className="text-sm font-medium text-danger">{`Error: ${drillFailureText(duplicate.error)}`}</p>
      )}
      <ExportDialog api={api} drillId={drill.id} drillName={drill.name} open={exporting} onOpenChange={setExporting} />
    </div>
  );
}
