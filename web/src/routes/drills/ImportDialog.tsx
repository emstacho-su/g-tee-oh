/**
 * The import dialog (S26, R3.14, O-310, O-232): a text area for an export code and Import. The
 * code is user input, so it is checked for presence and length here and fully by the api, which
 * decodes it and applies the same write rules as POST /drills. A refused code shows the api's
 * detail (which names the reason: version, damaged, too long, or the drill fields it refuses, with
 * their paths inside the code) in an alert; success creates a new drill and hands it to the
 * caller. The write is one intent with one Idempotency-Key (use-drill-writes.ts), so a double
 * submit imports once. The body unmounts when the dialog closes, so a reopened dialog is empty.
 */
import { useId, useState, type FormEvent } from "react";

import type { AppApi } from "../../api/index.js";
import { Button, Dialog } from "../../components/ui/index.js";
import { importFailureText } from "../../drills/failure-text.js";
import { EXPORT_CODE_PREFIX, MAX_EXPORT_CODE_LENGTH } from "../../drills/limits.js";
import { fieldErrorsOfFailure } from "../../drills/problem.js";
import type { Drill, FieldError } from "../../drills/types.js";
import { useImportDrill } from "../../drills/use-drill-writes.js";
import { ErrorText } from "./form-parts.js";

export const IMPORT_TEXT = {
  open: "Import a drill",
  title: "Import a drill",
  description: `Paste an export code. It starts with ${EXPORT_CODE_PREFIX} and creates a new drill; no drill is overwritten.`,
  label: "Export code",
  submit: "Import",
  importing: "Importing",
  empty: "Paste an export code.",
  tooLong: `An export code has at most ${MAX_EXPORT_CODE_LENGTH} characters.`,
} as const;

const CODE_FIELD_PREFIX = "body.export_code";

export interface ImportDialogProps {
  api: AppApi;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (drill: Drill) => void;
}

function localError(code: string): string | null {
  if (code === "") return IMPORT_TEXT.empty;
  if (code.length > MAX_EXPORT_CODE_LENGTH) return IMPORT_TEXT.tooLong;
  return null;
}

/** A field error inside the code, named by its path in the drill ("spot_filter.stake: ..."). */
function codeFieldText({ path, message }: FieldError): string {
  const inner = path.startsWith(`${CODE_FIELD_PREFIX}.`) ? path.slice(CODE_FIELD_PREFIX.length + 1) : "";
  return inner === "" ? message : `${inner}: ${message}`;
}

function Refusal({ error }: { error: unknown }) {
  const details = fieldErrorsOfFailure(error).map(codeFieldText);
  const headline = importFailureText(error);
  const extra = details.filter((detail) => detail !== headline);
  return (
    <div role="alert" data-testid="import-failure" className="flex flex-col gap-1 text-sm">
      <p className="font-medium text-danger">{`Error: ${headline}`}</p>
      {extra.length === 0 ? null : (
        <ul className="list-disc pl-5">
          {extra.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ImportBody({ api, onImported }: Pick<ImportDialogProps, "api" | "onImported">) {
  const id = useId();
  const [code, setCode] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const write = useImportDrill(api, onImported);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = code.trim();
    const problem = localError(trimmed);
    setChecked(problem);
    if (problem === null) write.send(trimmed);
  }

  return (
    <form aria-label={IMPORT_TEXT.title} onSubmit={submit} className="flex flex-col gap-3 text-sm" noValidate>
      <label htmlFor={id} className="font-medium">
        {IMPORT_TEXT.label}
      </label>
      <textarea
        id={id}
        value={code}
        rows={5}
        spellCheck={false}
        aria-invalid={checked !== null}
        aria-describedby={checked === null ? undefined : `${id}-error`}
        onChange={(event) => setCode(event.target.value)}
        className="rounded-md border border-border bg-surface-raised p-2 font-mono text-xs break-all"
      />
      <ErrorText id={`${id}-error`} messages={checked === null ? undefined : [checked]} />
      {write.error === null || write.busy ? null : <Refusal error={write.error} />}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={write.busy}>
          {write.busy ? IMPORT_TEXT.importing : IMPORT_TEXT.submit}
        </Button>
      </div>
    </form>
  );
}

export function ImportDialog({ api, open, onOpenChange, onImported }: ImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={IMPORT_TEXT.title} description={IMPORT_TEXT.description}>
      {open ? <ImportBody api={api} onImported={onImported} /> : null}
    </Dialog>
  );
}
