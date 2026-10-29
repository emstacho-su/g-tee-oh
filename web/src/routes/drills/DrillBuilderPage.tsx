/**
 * /drills/new/<page> and /drills/<id>/<page>: the drill builder (S26, R3.14, A7 section 2; S40,
 * O-405), one container with a page per section like /settings. A new drill starts from the
 * default draft (drills/draft.ts) under the heading "New drill"; an existing one is read (GET
 * /drills/{id}) and its header names it, with its spot summary and its Run, Export and Duplicate
 * actions. The form is keyed by the drill id, so opening another drill starts from that drill's
 * stored values, while moving between pages of one drill keeps the draft. A missing drill (404) or
 * a failed read shows its sentence with a way back to the library. A drill just created while the
 * player kept editing opens with those edits as unsaved changes (drills/draft-handoff.ts).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useAppApi } from "../../auth/index.js";
import { Button, LoadingNote, PageHeader } from "../../components/ui/index.js";
import type { BuilderSectionSlug } from "../../drills/builder-sections.js";
import { draftFromDrill, newDrillDraft } from "../../drills/draft.js";
import { clearHandedDraft, peekHandedDraft } from "../../drills/draft-handoff.js";
import { drillFailureText } from "../../drills/failure-text.js";
import { drillDetailQuery } from "../../drills/queries.js";
import { spotSummary, spotWords } from "../../drills/summary.js";
import { BuilderActions } from "./BuilderActions.js";
import { DrillForm } from "./DrillForm.js";

export const BUILDER_TEXT = {
  newHeading: "New drill",
  newDescription: "Build the drill page by page; Save drill saves every page.",
  editHeading: "Edit drill",
  loading: "Loading the drill",
  back: "Back to the drill library",
} as const;

export interface DrillBuilderPageProps {
  /** The open page of the builder container (S40, O-405). */
  section: BuilderSectionSlug;
  /** The drill to edit; absent on /drills/new. */
  drillId?: string;
  /** True right after this drill was created (?saved=1 or ?saved=rerun). */
  justCreated?: boolean;
  /** True when a Save and run landed after the draft changed again (?saved=rerun, S47). */
  editedSinceRun?: boolean;
}

function BackLink() {
  return (
    <Link to="/drills" className="text-sm underline">
      {BUILDER_TEXT.back}
    </Link>
  );
}

function ExistingDrill({ drillId, section, justCreated, editedSinceRun }: { drillId: string; section: BuilderSectionSlug; justCreated: boolean; editedSinceRun: boolean }) {
  const api = useAppApi();
  const drill = useQuery(drillDetailQuery(api, drillId));
  // Edits made while this drill was being created come along as unsaved changes (review round 1 B).
  const [carried] = useState(() => peekHandedDraft(drillId));
  // Whether the form's draft differs from the stored drill (S47, R3.14): the header actions follow it.
  const [dirty, setDirty] = useState(false);
  useEffect(() => clearHandedDraft(drillId), [drillId]);
  if (drill.data === undefined) {
    return (
      <>
        <PageHeader title={BUILDER_TEXT.editHeading} actions={<BackLink />} />
        {drill.isError ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm">
            <p className="text-danger">{drillFailureText(drill.error)}</p>
            <Button size="sm" onClick={() => void drill.refetch()}>
              Try again
            </Button>
            <BackLink />
          </div>
        ) : (
          <LoadingNote text={BUILDER_TEXT.loading} />
        )}
      </>
    );
  }
  const stored = drill.data;
  return (
    <>
      <div className="flex flex-col gap-2">
        <PageHeader title={stored.name} actions={<BackLink />} />
        <p data-testid="spot-summary" className="text-sm text-muted md:text-base" title={spotSummary(stored.spot_filter)}>
          {spotWords(stored.spot_filter)}
        </p>
      </div>
      <BuilderActions api={api} drill={stored} dirty={dirty} />
      <DrillForm
        key={stored.id}
        initial={draftFromDrill(stored)}
        {...(carried === undefined ? {} : { start: carried })}
        section={section}
        drill={stored}
        justCreated={justCreated}
        editedSinceRun={editedSinceRun}
        onDirtyChange={setDirty}
      />
    </>
  );
}

export function DrillBuilderPage({ section, drillId, justCreated = false, editedSinceRun = false }: DrillBuilderPageProps) {
  return (
    <section className="flex flex-col gap-6">
      {drillId === undefined ? (
        <>
          <PageHeader title={BUILDER_TEXT.newHeading} description={BUILDER_TEXT.newDescription} actions={<BackLink />} />
          <DrillForm initial={newDrillDraft()} section={section} />
        </>
      ) : (
        <ExistingDrill drillId={drillId} section={section} justCreated={justCreated} editedSinceRun={editedSinceRun} />
      )}
    </section>
  );
}
