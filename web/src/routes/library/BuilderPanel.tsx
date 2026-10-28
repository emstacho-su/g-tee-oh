/**
 * The admin's builder panel on /library (S28, R3.5, A7 section 2, O-290, O-295): BuilderHealth
 * with pause and resume, then the settings form. Shown only to an admin (SessionInfo.user
 * .is_admin); a member sees one line saying the controls are for admins, and the api answers 403
 * to a member's admin request whatever the page shows.
 */
import type { AppApi } from "../../api/index.js";
import { BuilderHealth } from "../../components/library/BuilderHealth.js";
import { BuilderSettingsForm } from "../../components/library/BuilderSettingsForm.js";
import { Button, LoadingNote } from "../../components/ui/index.js";
import { adminFailureText } from "../../library/admin-text.js";
import type { BuildProgressEvent } from "../../library/events.js";
import { useBuilderStatus, usePauseControl, useSaveSettings } from "../../library/use-builder.js";

export const MEMBER_NOTE = "Builder health and controls are for admins.";

export interface BuilderPanelProps {
  api: AppApi;
  isAdmin: boolean;
  progress: BuildProgressEvent | null;
}

function AdminBuilderPanel({ api, progress }: Omit<BuilderPanelProps, "isAdmin">) {
  const status = useBuilderStatus(api, true);
  const pause = usePauseControl(api);
  const save = useSaveSettings(api);
  if (status.data === undefined) {
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
  return (
    <div className="flex flex-col gap-6">
      <BuilderHealth
        status={status.data}
        progress={progress}
        onSetPaused={pause.setPaused}
        pending={pause.pending}
        failure={pause.error === null ? null : adminFailureText(pause.error)}
      />
      <BuilderSettingsForm settings={status.data.settings} save={save} />
    </div>
  );
}

export function BuilderPanel({ api, isAdmin, progress }: BuilderPanelProps) {
  if (!isAdmin) return <p className="text-sm text-muted">{MEMBER_NOTE}</p>;
  return <AdminBuilderPanel api={api} progress={progress} />;
}
