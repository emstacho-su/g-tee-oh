/**
 * /settings (A7 section 2). A7's settings screen is split between sessions: S28 builds the
 * builder schedule (R3.5, O-296), shown to an admin only (O-290); S32 adds session defaults,
 * hotkeys and cosmetics, which this page names as coming.
 */
import { useAppApi } from "../../auth/index.js";
import { BuilderScheduleForm } from "../../components/library/BuilderScheduleForm.js";
import { Button, LoadingNote } from "../../components/ui/index.js";
import { useBuilderStatus, useIsAdmin, useSaveSettings } from "../../library/use-builder.js";

export const LATER_SETTINGS_NOTE = "Session defaults, hotkeys and cosmetics arrive in S32.";
export const SCHEDULE_MEMBER_NOTE = "The builder schedule is for admins.";

function ScheduleSection() {
  const api = useAppApi();
  const status = useBuilderStatus(api, true);
  const save = useSaveSettings(api);
  if (status.data !== undefined) return <BuilderScheduleForm settings={status.data.settings} save={save} />;
  if (!status.isError) return <LoadingNote text="Loading the builder settings." />;
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-sm">
      <p className="text-danger">The builder settings could not be loaded.</p>
      <Button size="sm" onClick={() => void status.refetch()}>
        Try again
      </Button>
    </div>
  );
}

export function SettingsPage() {
  const isAdmin = useIsAdmin();
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {isAdmin ? <ScheduleSection /> : <p className="text-sm text-muted">{SCHEDULE_MEMBER_NOTE}</p>}
      <p className="text-sm text-muted">{LATER_SETTINGS_NOTE}</p>
    </section>
  );
}
