/**
 * The drill builder form (S26, R3.14, O-317; S40, O-405): the draft (drills/draft.ts) edited page
 * by page inside one container, then saved as a create (new drill) or a patch of the changed
 * fields (existing drill).
 *
 * Mechanism: the draft is the form's one state value and the form stays mounted while only the
 * page changes (the route keys it by the drill id), so every page edits the same draft; the open
 * page (`section`) is the only section rendered, beside the "Drill sections" list (BuilderNav), and
 * one Save bar sits under every page. Save runs the client rules (draftToCreate or draftToPatch)
 * over the whole draft; with errors nothing is sent, the alert links each page holding errors and
 * the list marks it. Otherwise one intent mutation sends the body (use-drill-writes.ts, one
 * Idempotency-Key per intent, a retry of the same body reuses it). A 400's field errors are shown
 * next to their fields beside the client's, until the draft changes; any other failure shows its
 * sentence. A create goes on to the new drill's same page with saved=1; a patch says it saved, or
 * that nothing changed when no field differs.
 *
 * Unsaved edits (PM note 3): the draft is dirty while it differs from the last saved (or loaded)
 * draft; LeaveGuard asks before leaving the builder then. A successful save makes the draft clean,
 * marking it before the create's own navigation so that navigation never asks.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { describeFailureForLog } from "../../api/http-status.js";
import { useAppApi } from "../../auth/index.js";
import { Button } from "../../components/ui/index.js";
import { errorCountsBySection, type BuilderSectionSlug } from "../../drills/builder-sections.js";
import { draftToCreate, draftToPatch, type DraftResult, type DrillDraft } from "../../drills/draft.js";
import { drillFailureText } from "../../drills/failure-text.js";
import { groupFieldErrors } from "../../drills/field-errors.js";
import { fieldErrorsOfFailure, omittedErrorsOfFailure } from "../../drills/problem.js";
import type { Drill, FieldError } from "../../drills/types.js";
import { useSaveDrill, type SaveInput } from "../../drills/use-drill-writes.js";
import { BoardSection } from "./BoardSection.js";
import { BuilderNav } from "./BuilderNav.js";
import { FormAlert } from "./FormAlert.js";
import { FormSection, TextField } from "./form-parts.js";
import { GameSection, type SectionProps } from "./GameSection.js";
import { HandsSection } from "./HandsSection.js";
import { LeaveGuard } from "./LeaveGuard.js";
import { SeatsSection } from "./SeatsSection.js";
import { PanelsSection, TrainerSection } from "./TrainerSection.js";

export const FORM_TEXT = {
  save: "Save drill",
  saving: "Saving",
  cancel: "Cancel",
  saveCovers: "Save drill saves every page.",
  saved: "Drill saved.",
  changesSaved: "Changes saved.",
  unchanged: "Nothing changed, so nothing was saved.",
} as const;

export interface DrillFormProps {
  initial: DrillDraft;
  /** The open page of the builder. */
  section: BuilderSectionSlug;
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

function SectionPage({ section, ...props }: SectionProps & { section: BuilderSectionSlug }) {
  switch (section) {
    case "details":
      return <NameSection {...props} />;
    case "game":
      return <GameSection {...props} />;
    case "seats":
      return <SeatsSection {...props} />;
    case "hands":
      return <HandsSection {...props} />;
    case "board":
      return <BoardSection {...props} />;
    case "trainer":
      return <TrainerSection {...props} />;
    case "panels":
      return <PanelsSection {...props} />;
  }
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

/** Drafts are plain data, so two with the same JSON hold the same edits. */
function sameDraft(left: DrillDraft, right: DrillDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface AfterSave {
  setStatus: (status: string) => void;
  markClean: () => void;
  section: BuilderSectionSlug;
}

function useAfterSave({ setStatus, markClean, section }: AfterSave) {
  const navigate = useNavigate();
  return (saved: Drill, input: SaveInput) => {
    markClean();
    if (input.kind === "patch") {
      setStatus(FORM_TEXT.changesSaved);
      return;
    }
    navigate({ to: "/drills/$id/$section", params: { id: saved.id, section }, search: { saved: "1" } }).catch((error: unknown) => {
      console.error(`g-tee-oh: the builder navigation failed (${describeFailureForLog(error)})`);
    });
  };
}

/**
 * After a create (PR #30 review LOW 11): once this form has mounted with "Drill saved.", the URL
 * drops ?saved=1 through a replace navigation, so a reload, Back or a copied link does not say it
 * again. The form keeps its status state across that navigation (same route, same key).
 */
function useDropSavedFlag(drillId: string | undefined, justCreated: boolean, section: BuilderSectionSlug): void {
  const navigate = useNavigate();
  const sectionRef = useRef(section);
  useEffect(() => {
    if (!justCreated || drillId === undefined) return;
    navigate({ to: "/drills/$id/$section", params: { id: drillId, section: sectionRef.current }, search: {}, replace: true }).catch((error: unknown) => {
      console.error(`g-tee-oh: dropping saved=1 from the builder URL failed (${describeFailureForLog(error)})`);
    });
  }, [drillId, justCreated, navigate]);
}

/**
 * The draft and its saved baseline; dirtyRef follows the dirty state for the leave guard. After a
 * save the baseline is the draft that was sent (sentRef), so an edit made while the save was in
 * flight stays unsaved.
 */
function useDraft(initial: DrillDraft) {
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const dirty = !sameDraft(draft, baseline);
  const dirtyRef = useRef(dirty);
  const draftRef = useRef(draft);
  const sentRef = useRef(initial);
  dirtyRef.current = dirty;
  draftRef.current = draft;
  const markClean = () => {
    dirtyRef.current = !sameDraft(draftRef.current, sentRef.current);
    setBaseline(sentRef.current);
  };
  return { draft, setDraft, dirty, dirtyRef, sentRef, markClean };
}

export function DrillForm({ initial, section, drill, justCreated = false }: DrillFormProps) {
  const api = useAppApi();
  const { draft, setDraft, dirty, dirtyRef, sentRef, markClean } = useDraft(initial);
  const [checkedDraft, setCheckedDraft] = useState<DrillDraft | null>(null);
  const [status, setStatus] = useState(justCreated ? FORM_TEXT.saved : "");
  const save = useSaveDrill(api, useAfterSave({ setStatus, markClean, section }));
  useDropSavedFlag(drill?.id, justCreated, section);

  // Client errors show once Save was pressed, and then follow every edit.
  const clientErrors = checkedDraft === null ? [] : errorsOf(resultOf(draft, drill));
  const sentThisDraft = checkedDraft === draft && !save.busy;
  const serverErrors = sentThisDraft ? fieldErrorsOfFailure(save.error) : [];
  const errors = groupFieldErrors([...clientErrors, ...serverErrors]);
  const counts = errorCountsBySection(errors);
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
    sentRef.current = draft;
    save.send(result.body);
  }

  return (
    <form aria-label="Drill builder" onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormAlert errors={errors} counts={counts} failure={failure} omitted={sentThisDraft ? omittedErrorsOfFailure(save.error) : 0} drillId={drill?.id} />
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <BuilderNav drillId={drill?.id} counts={counts} />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <SectionPage section={section} draft={draft} onChange={change} errors={errors} />
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/50 bg-surface-sunken px-4 py-3">
            <Button type="submit" variant="primary" disabled={save.busy}>
              {save.busy ? FORM_TEXT.saving : FORM_TEXT.save}
            </Button>
            <Button asChild>
              <Link to="/drills">{FORM_TEXT.cancel}</Link>
            </Button>
            <p className="text-sm text-muted">{FORM_TEXT.saveCovers}</p>
            <p role="status" data-testid="builder-status" className="text-sm font-medium">
              {status}
            </p>
          </div>
        </div>
      </div>
      <LeaveGuard dirtyRef={dirtyRef} dirty={dirty} />
    </form>
  );
}
