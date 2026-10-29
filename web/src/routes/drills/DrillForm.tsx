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
 * S47 (R3.36, R3.37, O-483): a second submit, Save and run, saves and opens the run screen with the
 * autostart flag; a failed Save moves to the first page with an error and focuses its first invalid
 * control (use-focus-first-error.ts); the reach status line under the page counts the spots the
 * draft reaches (ReachStatus); the page is told when the draft is dirty (onDirtyChange).
 *
 * Unsaved edits (PM note 3): the draft is dirty while it differs from the last saved (or loaded)
 * draft (compared by meaning, drills/draft-compare.ts); LeaveGuard asks before leaving the builder
 * then. A successful save makes the draft clean; the create's own navigation skips the guard and
 * carries any edit made while the create was in flight to the new drill (review round 1 B).
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { describeFailureForLog } from "../../api/http-status.js";
import { useAppApi } from "../../auth/index.js";
import { Button } from "../../components/ui/index.js";
import { errorCountsBySection, type BuilderSectionSlug } from "../../drills/builder-sections.js";
import { draftToCreate, draftToPatch, type DraftResult, type DrillDraft } from "../../drills/draft.js";
import { draftsEqual } from "../../drills/draft-compare.js";
import { handOffDraft } from "../../drills/draft-handoff.js";
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
import { ReachStatus } from "./ReachStatus.js";
import { PanelsSection, TrainerSection } from "./TrainerSection.js";
import { useFocusFirstError } from "./use-focus-first-error.js";

export const FORM_TEXT = {
  save: "Save drill",
  saveAndRun: "Save and run",
  saving: "Saving",
  cancel: "Cancel",
  saveCovers: "Save drill saves every page.",
  saved: "Drill saved.",
  changesSaved: "Changes saved.",
  unchanged: "Nothing changed, so nothing was saved.",
} as const;

export interface DrillFormProps {
  /** The saved baseline: the stored drill as a draft, or the default draft for a new one. */
  initial: DrillDraft;
  /** Where editing starts when it differs from the baseline: edits carried from the create (review round 1 B). */
  start?: DrillDraft;
  /** The open page of the builder. */
  section: BuilderSectionSlug;
  /** The stored drill when editing; absent for a new drill. */
  drill?: Drill;
  /** True right after the create that led here (?saved=1). */
  justCreated?: boolean;
  /** Told whenever the draft becomes dirty or clean, so the page can hold actions that act on the stored drill (S47, R3.14). */
  onDirtyChange?: (dirty: boolean) => void;
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

interface AfterSave {
  setStatus: (status: string) => void;
  markClean: () => void;
  /** The edits made since the save was sent, or undefined when there are none. */
  unsentEdits: () => DrillDraft | undefined;
  section: BuilderSectionSlug;
  /** Whether the save that is landing was "Save and run" (S47, R3.36): the run screen opens with autostart. */
  runAfter: () => boolean;
}

/**
 * After a save (review round 1 B): a patch says it saved; a create moves to the new drill's same
 * page. That move is the builder's own, so it skips the leave guard, and any edit made while the
 * create was in flight is handed to the new drill's builder (drills/draft-handoff.ts), where it
 * stays an unsaved change and the next Save patches the new drill.
 */
function useAfterSave({ setStatus, markClean, unsentEdits, section, runAfter }: AfterSave) {
  const navigate = useNavigate();
  const logFailure = (error: unknown): void => {
    console.error(`g-tee-oh: the builder navigation failed (${describeFailureForLog(error)})`);
  };
  return (saved: Drill, input: SaveInput) => {
    markClean();
    if (runAfter()) {
      navigate({ to: "/drills/$id/run", params: { id: saved.id }, search: { start: "1" }, ignoreBlocker: true }).catch(logFailure);
      return;
    }
    if (input.kind === "patch") {
      setStatus(FORM_TEXT.changesSaved);
      return;
    }
    const edits = unsentEdits();
    if (edits !== undefined) handOffDraft(saved.id, edits);
    navigate({ to: "/drills/$id/$section", params: { id: saved.id, section }, search: { saved: "1" }, ignoreBlocker: true }).catch(logFailure);
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
function useDraft(initial: DrillDraft, start: DrillDraft = initial) {
  const [draft, setDraft] = useState(start);
  const [baseline, setBaseline] = useState(initial);
  const dirty = !draftsEqual(draft, baseline);
  const dirtyRef = useRef(dirty);
  const draftRef = useRef(draft);
  const sentRef = useRef(initial);
  dirtyRef.current = dirty;
  draftRef.current = draft;
  const markClean = () => {
    dirtyRef.current = !draftsEqual(draftRef.current, sentRef.current);
    setBaseline(sentRef.current);
  };
  const unsentEdits = () => (draftsEqual(draftRef.current, sentRef.current) ? undefined : draftRef.current);
  return { draft, setDraft, dirty, dirtyRef, sentRef, markClean, unsentEdits };
}

export function DrillForm({ initial, start, section, drill, justCreated = false, onDirtyChange }: DrillFormProps) {
  const api = useAppApi();
  const { draft, setDraft, dirty, dirtyRef, sentRef, markClean, unsentEdits } = useDraft(initial, start);
  const [checkedDraft, setCheckedDraft] = useState<DrillDraft | null>(null);
  const [status, setStatus] = useState(justCreated ? FORM_TEXT.saved : "");
  // Set by the Save and run button's click, which lands before the form's submit event (S47, R3.36).
  const runIntent = useRef(false);
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const focusFirstError = useFocusFirstError(section, drill?.id, formRef);
  const save = useSaveDrill(api, useAfterSave({ setStatus, markClean, unsentEdits, section, runAfter: () => runIntent.current }));
  useDropSavedFlag(drill?.id, justCreated, section);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

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
    if (!result.ok) {
      runIntent.current = false;
      focusFirstError(errorCountsBySection(groupFieldErrors(result.errors)));
      return;
    }
    if (result.body.kind === "patch" && Object.keys(result.body.body).length === 0) {
      if (runIntent.current && drill !== undefined) {
        runIntent.current = false;
        navigate({ to: "/drills/$id/run", params: { id: drill.id }, search: { start: "1" } }).catch((error: unknown) => {
          console.error(`g-tee-oh: opening the run screen failed (${describeFailureForLog(error)})`);
        });
        return;
      }
      setStatus(FORM_TEXT.unchanged);
      return;
    }
    sentRef.current = draft;
    save.send(result.body);
  }

  return (
    <form ref={formRef} aria-label="Drill builder" onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormAlert errors={errors} counts={counts} failure={failure} omitted={sentThisDraft ? omittedErrorsOfFailure(save.error) : 0} drillId={drill?.id} />
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <BuilderNav drillId={drill?.id} counts={counts} />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <SectionPage section={section} draft={draft} onChange={change} errors={errors} />
          <ReachStatus draft={draft} />
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/50 bg-surface-sunken px-4 py-3">
            <Button type="submit" variant="primary" disabled={save.busy} onClick={() => (runIntent.current = false)}>
              {save.busy ? FORM_TEXT.saving : FORM_TEXT.save}
            </Button>
            <Button type="submit" disabled={save.busy} onClick={() => (runIntent.current = true)}>
              {FORM_TEXT.saveAndRun}
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
