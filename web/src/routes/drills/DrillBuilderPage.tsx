/**
 * /drills/new and /drills/$id: the drill builder (S26, R3.14, A7 section 2). A new drill starts
 * from the default draft (drills/draft.ts); an existing one is read (GET /drills/{id}) and shown
 * with its spot summary and its Run, Export and Duplicate actions above the form. The form is
 * keyed by the drill id, so opening another drill starts from that drill's stored values. A
 * missing drill (404) or a failed read shows its sentence with a way back to the library.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { useAppApi } from "../../auth/index.js";
import { Button, LoadingNote } from "../../components/ui/index.js";
import { draftFromDrill, newDrillDraft } from "../../drills/draft.js";
import { drillFailureText } from "../../drills/failure-text.js";
import { drillDetailQuery } from "../../drills/queries.js";
import { spotSummary } from "../../drills/summary.js";
import { BuilderActions } from "./BuilderActions.js";
import { DrillForm } from "./DrillForm.js";

export const BUILDER_TEXT = {
  newHeading: "New drill",
  editHeading: "Edit drill",
  loading: "Loading the drill",
  back: "Back to the drill library",
} as const;

export interface DrillBuilderPageProps {
  /** The drill to edit; absent on /drills/new. */
  drillId?: string;
  /** True right after this drill was created (?saved=1). */
  justCreated?: boolean;
}

function BackLink() {
  return (
    <Link to="/drills" className="text-sm underline">
      {BUILDER_TEXT.back}
    </Link>
  );
}

function ExistingDrill({ drillId, justCreated }: { drillId: string; justCreated: boolean }) {
  const api = useAppApi();
  const drill = useQuery(drillDetailQuery(api, drillId));
  if (drill.data === undefined) {
    if (!drill.isError) return <LoadingNote text={BUILDER_TEXT.loading} />;
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm">
        <p className="text-danger">{drillFailureText(drill.error)}</p>
        <Button size="sm" onClick={() => void drill.refetch()}>
          Try again
        </Button>
        <BackLink />
      </div>
    );
  }
  const stored = drill.data;
  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-lg font-medium">{stored.name}</p>
        <p data-testid="spot-summary" className="text-sm text-muted">
          {spotSummary(stored.spot_filter)}
        </p>
      </div>
      <BuilderActions api={api} drill={stored} />
      <DrillForm key={stored.id} initial={draftFromDrill(stored)} drill={stored} justCreated={justCreated} />
    </>
  );
}

export function DrillBuilderPage({ drillId, justCreated = false }: DrillBuilderPageProps) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">{drillId === undefined ? BUILDER_TEXT.newHeading : BUILDER_TEXT.editHeading}</h1>
        <BackLink />
      </div>
      {drillId === undefined ? <DrillForm initial={newDrillDraft()} /> : <ExistingDrill drillId={drillId} justCreated={justCreated} />}
    </section>
  );
}
