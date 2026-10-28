/**
 * The admin pages of /library (S28, R3.5, A7 section 2, O-290, O-295; S40, O-406): Builder state
 * (BuilderHealth with pause and resume and the build in progress) and Builder settings (the
 * settings form, with a link to the overnight schedule on /settings). Shown only to an admin
 * (SessionInfo.user.is_admin); a member opening either URL reads one line saying the controls are
 * for admins, no admin request is made, and the api answers 403 to a member's admin request
 * whatever the page shows. Both pages read the builder status through one cached query, so a save
 * on one shows on the other.
 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { AppApi } from "../../api/index.js";
import { BuilderHealth } from "../../components/library/BuilderHealth.js";
import { BuilderSettingsForm } from "../../components/library/BuilderSettingsForm.js";
import { Button, LoadingNote, Panel } from "../../components/ui/index.js";
import type { BuilderStatus } from "../../contracts.js";
import { adminFailureText } from "../../library/admin-text.js";
import type { BuildProgressEvent } from "../../library/events.js";
import { useBuilderStatus, usePauseControl, useSaveSettings } from "../../library/use-builder.js";

export const MEMBER_NOTE = "Builder health and controls are for admins.";
export const SCHEDULE_LINK_TEXT = "Set the overnight window in Settings";

interface AdminPageProps {
  api: AppApi;
  isAdmin: boolean;
}

/** The builder status, or its loading note, or a failure with a retry. */
function WithStatus({ api, children }: { api: AppApi; children: (status: BuilderStatus) => ReactNode }) {
  const status = useBuilderStatus(api, true);
  if (status.data !== undefined) return <>{children(status.data)}</>;
  if (!status.isError) return <LoadingNote text="Loading the builder status." />;
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-sm">
      <p className="text-danger">The builder status could not be loaded.</p>
      <Button size="sm" onClick={() => void status.refetch()}>
        Try again
      </Button>
    </div>
  );
}

function MemberNote() {
  return (
    <Panel>
      <p className="text-sm text-muted">{MEMBER_NOTE}</p>
    </Panel>
  );
}

function AdminBuilderState({ api, progress }: { api: AppApi; progress: BuildProgressEvent | null }) {
  const pause = usePauseControl(api);
  return (
    <WithStatus api={api}>
      {(status) => (
        <BuilderHealth
          status={status}
          progress={progress}
          onSetPaused={pause.setPaused}
          pending={pause.pending}
          failure={pause.error === null ? null : adminFailureText(pause.error)}
        />
      )}
    </WithStatus>
  );
}

function AdminBuilderSettings({ api }: { api: AppApi }) {
  const save = useSaveSettings(api);
  return (
    <Panel>
      <WithStatus api={api}>{(status) => <BuilderSettingsForm settings={status.settings} save={save} />}</WithStatus>
      <Link to="/settings/$section" params={{ section: "builder-schedule" }} className="self-start text-sm font-medium underline">
        {SCHEDULE_LINK_TEXT}
      </Link>
    </Panel>
  );
}

export interface BuilderStatePageProps extends AdminPageProps {
  progress: BuildProgressEvent | null;
}

export function BuilderStatePage({ api, isAdmin, progress }: BuilderStatePageProps) {
  return isAdmin ? <AdminBuilderState api={api} progress={progress} /> : <MemberNote />;
}

export function BuilderSettingsPage({ api, isAdmin }: AdminPageProps) {
  return isAdmin ? <AdminBuilderSettings api={api} /> : <MemberNote />;
}
