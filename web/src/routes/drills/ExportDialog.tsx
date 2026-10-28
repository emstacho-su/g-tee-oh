/**
 * The export dialog (S26, R3.14, O-310): reads the drill's export code when it opens (GET
 * /drills/{id}/export) and shows it in a read-only field with a Copy button. Copy writes the code
 * to the clipboard and says so in a live region; where the clipboard is refused, it says to select
 * the code and copy it by hand (focusing the field selects all of it). A failed read shows its
 * reason with a retry. The code is never cached past the dialog (queries.ts).
 */
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import type { AppApi } from "../../api/index.js";
import { Button, Dialog, LoadingNote } from "../../components/ui/index.js";
import { drillFailureText } from "../../drills/failure-text.js";
import { drillExportQuery } from "../../drills/queries.js";

export const EXPORT_TEXT = {
  title: "Export code",
  description: "Paste this code into Import on any g-tee-oh to get a copy of this drill.",
  label: "Export code",
  copy: "Copy",
  copied: "Copied.",
  copyFailed: "Copying failed. Select the code and copy it by hand.",
  loading: "Reading the export code",
} as const;

export interface ExportDialogProps {
  api: AppApi;
  drillId: string;
  drillName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type CopyState = "idle" | "copied" | "failed";

async function copyText(text: string): Promise<void> {
  if (typeof navigator === "undefined" || navigator.clipboard === undefined) throw new Error("no clipboard");
  await navigator.clipboard.writeText(text);
}

function CodeField({ code }: { code: string }) {
  const id = useId();
  const [copy, setCopy] = useState<CopyState>("idle");
  return (
    <div className="flex flex-col gap-2 text-sm">
      <label htmlFor={id} className="font-medium">
        {EXPORT_TEXT.label}
      </label>
      <textarea
        id={id}
        readOnly
        value={code}
        rows={4}
        onFocus={(event) => event.target.select()}
        className="rounded-md border border-border bg-surface-sunken p-2 font-mono text-xs break-all"
      />
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          onClick={() => {
            copyText(code).then(
              () => setCopy("copied"),
              () => setCopy("failed"),
            );
          }}
        >
          {EXPORT_TEXT.copy}
        </Button>
        <p role="status" className="text-muted">
          {copy === "copied" ? EXPORT_TEXT.copied : copy === "failed" ? EXPORT_TEXT.copyFailed : ""}
        </p>
      </div>
    </div>
  );
}

function ExportBody({ api, drillId }: { api: AppApi; drillId: string }) {
  const code = useQuery(drillExportQuery(api, drillId));
  if (code.data !== undefined) return <CodeField code={code.data} />;
  if (!code.isError) return <LoadingNote text={EXPORT_TEXT.loading} />;
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-sm">
      <p className="text-danger">{drillFailureText(code.error)}</p>
      <Button size="sm" onClick={() => void code.refetch()}>
        Try again
      </Button>
    </div>
  );
}

export function ExportDialog({ api, drillId, drillName, open, onOpenChange }: ExportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`${EXPORT_TEXT.title}: ${drillName}`} description={EXPORT_TEXT.description}>
      {open ? <ExportBody api={api} drillId={drillId} /> : null}
    </Dialog>
  );
}
