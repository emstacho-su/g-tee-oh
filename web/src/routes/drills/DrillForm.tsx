/**
 * The drill builder form (S26, R3.14, O-317): the draft (drills/draft.ts) edited through the
 * sections that mirror the schema, then saved as a create (new drill) or a patch of the changed
 * fields (existing drill).
 *
 * Mechanism: the draft is the form's one state value; each section returns a new draft. Save runs
 * the client rules (draftToCreate or draftToPatch); with errors nothing is sent and every field
 * shows its line. Otherwise one intent mutation sends the body (use-drill-writes.ts, one
 * Idempotency-Key per intent, a retry of the same body reuses it). A 400's field errors are shown
 * next to their fields beside the client's, until the draft changes; any other failure shows its
 * sentence. A create goes on to the new drill's builder with saved=1; a patch says it saved, or
 * that nothing changed when no field differs.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { describeFailureForLog } from "../../api/http-status.js";
import { useAppApi } from "../../auth/index.js";
import { Button } from "../../components/ui/index.js";
import { draftToCreate, draftToPatch, type DraftResult, type DrillDraft } from "../../drills/draft.js";
import { drillFailureText } from "../../drills/failure-text.js";
import { groupFieldErrors, type GroupedErrors } from "../../drills/field-errors.js";
import { fieldErrorsOfFailure } from "../../drills/problem.js";
import type { Drill, FieldError } from "../../drills/types.js";
import { useSaveDrill, type SaveInput } from "../../drills/use-drill-writes.js";
import { BoardSection } from "./BoardSection.js";
import { FormSection, TextField } from "./form-parts.js";
import { GameSection, type SectionProps } from "./GameSection.js";
import { HandsSection } from "./HandsSection.js";
import { SeatsSection } from "./SeatsSection.js";
import { PanelsSection, TrainerSection } from "./TrainerSection.js";

export const FORM_TEXT = {
  save: "Save drill",
  saving: "Saving",
  cancel: "Cancel",
  fix: "Fix the fields marked below.",
  saved: "Drill saved.",
  changesSaved: "Changes saved.",
  unchanged: "Nothing changed, so nothing was saved.",
} as const;

export interface DrillFormProps {
  initial: DrillDraft;
  /** The stored drill when editing; absent for a new drill. */
  drill?: Drill;
  /** True right after the create that led here (?saved=1). */
  justCreated?: boolean;
}

function NameSection({ draft, onChange, errors }: SectionProps) {
  return (
    <FormSection title="Name and tags">
      <TextField label="Name" value={draft.name} onChange={(name) => onChange({ ...draft, name })} errors={errors.name} />
      <TextField
        label="Tags"
        hint="Separate tags with spaces or commas: lower-case letters, digits, - and _."
        value={draft.tagsText}
        onChange={(tagsText) => onChange({ ...draft, tagsText })}
        errors={errors.tags}
      />
    </FormSection>
  );
}

function resultOf(draft: DrillDraft, drill: Drill | undefined): DraftResult<SaveInput> {
  if (drill === undefined) {
    const created = draftToCreate(draft);
    return created.ok ? { ok: true, body: { kind: "create", body: created.body } } : created;
  }
  const patched = draftToPatch(draft, drill);
  return patched.ok ? { ok: true, body: { kind: "patch", id: drill.id, body: patched.body } } : patched;
}

function errorsOf(result: DraftResult<SaveInput>): readonly FieldError[] {
  return result.ok ? [] : result.errors;
}

function FormAlert({ errors, failure }: { errors: GroupedErrors; failure: string | null }) {
  const formMessages = errors.form ?? [];
  const hasFieldErrors = Object.keys(errors).some((key) => key !== "form");
  if (failure === null && formMessages.length === 0 && !hasFieldErrors) return null;
  return (
    <div role="alert" data-testid="form-alert" className="rounded-md border border-danger p-3 text-sm">
      <p className="font-medium text-danger">{`Error: ${failure ?? FORM_TEXT.fix}`}</p>
      {formMessages.length === 0 ? null : (
        <ul className="list-disc pl-5">
          {formMessages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function useAfterSave(setStatus: (status: string) => void) {
  const navigate = useNavigate();
  return (saved: Drill, input: SaveInput) => {
    if (input.kind === "patch") {
      setStatus(FORM_TEXT.changesSaved);
      return;
    }
    navigate({ to: "/drills/$id", params: { id: saved.id }, search: { saved: "1" } }).catch((error: unknown) => {
      console.error(`g-tee-oh: the builder navigation failed (${describeFailureForLog(error)})`);
    });
  };
}

export function DrillForm({ initial, drill, justCreated = false }: DrillFormProps) {
  const api = useAppApi();
  const [draft, setDraft] = useState(initial);
  const [checkedDraft, setCheckedDraft] = useState<DrillDraft | null>(null);
  const [status, setStatus] = useState(justCreated ? FORM_TEXT.saved : "");
  const save = useSaveDrill(api, useAfterSave(setStatus));

  // Client errors show once Save was pressed, and then follow every edit.
  const clientErrors = checkedDraft === null ? [] : errorsOf(resultOf(draft, drill));
  const sentThisDraft = checkedDraft === draft && !save.busy;
  const serverErrors = sentThisDraft ? fieldErrorsOfFailure(save.error) : [];
  const errors = groupFieldErrors([...clientErrors, ...serverErrors]);
  const failure = sentThisDraft && save.error !== null && save.error !== undefined && serverErrors.length === 0 ? drillFailureText(save.error) : null;

  function change(next: DrillDraft): void {
    setDraft(next);
    setStatus("");
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setCheckedDraft(draft);
    const result = resultOf(draft, drill);
    if (!result.ok) return;
    if (result.body.kind === "patch" && Object.keys(result.body.body).length === 0) {
      setStatus(FORM_TEXT.unchanged);
      return;
    }
    save.send(result.body);
  }

  const sections = { draft, onChange: change, errors };
  return (
    <form aria-label="Drill builder" onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormAlert errors={errors} failure={failure} />
      <NameSection {...sections} />
      <GameSection {...sections} />
      <SeatsSection {...sections} />
      <HandsSection {...sections} />
      <BoardSection {...sections} />
      <TrainerSection {...sections} />
      <PanelsSection {...sections} />
      <div className="flex flex-wrap items-center gap-3 border-t border-border py-3">
        <Button type="submit" variant="primary" disabled={save.busy}>
          {save.busy ? FORM_TEXT.saving : FORM_TEXT.save}
        </Button>
        <Button asChild>
          <Link to="/drills">{FORM_TEXT.cancel}</Link>
        </Button>
        <p role="status" data-testid="builder-status" className="text-sm">
          {status}
        </p>
      </div>
    </form>
  );
}
