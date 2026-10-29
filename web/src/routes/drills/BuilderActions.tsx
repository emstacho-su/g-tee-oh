/**
 * The actions an existing drill's builder offers besides Save (S26, R3.14, O-311; S40 on the S36
 * buttons): Run (/drills/$id/run), Export (the export dialog) and Duplicate (a copy named
 * "<name> (copy)", announced with a link to its builder). They act on the drill as stored, not on
 * unsaved edits; Run is a navigation, so the leave guard asks first when the draft is dirty.
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

export function BuilderActions({ api, drill }: BuilderActionsProps) {
  const [exporting, setExporting] = useState(false);
  const duplicate = useDuplicateDrill(api);
  const copy = duplicate.result;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="primary">
          <Link to="/drills/$id/run" params={{ id: drill.id }}>
            Run
          </Link>
        </Button>
        <Button onClick={() => setExporting(true)}>Export</Button>
        <Button disabled={duplicate.busy} onClick={() => duplicate.send(drill.id)}>
          Duplicate
        </Button>
      </div>
      <div role="status" className="text-sm">
        {copy === undefined ? null : (
          <p>
            {`Duplicated as ${copy.name}. `}
            <Link to="/drills/$id/$section" params={{ id: copy.id, section: "details" }} className="underline">
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
