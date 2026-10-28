/**
 * /settings (A7 section 2). S28 built the builder schedule (R3.5, O-296), shown to an admin only
 * (O-290). S32 adds, for everyone, the session defaults of automated training (R4.12, O-323), the
 * cosmetics (R4.14, O-323) and the read-only hotkey list (O-327). Session defaults and cosmetics
 * are kept on this browser; the server owns which cosmetics are unlocked.
 */
import { useAppApi } from "../../auth/index.js";
import { BuilderScheduleForm } from "../../components/library/BuilderScheduleForm.js";
import { Button, LoadingNote } from "../../components/ui/index.js";
import { useBuilderStatus, useIsAdmin, useSaveSettings } from "../../library/use-builder.js";
import { CosmeticsSection } from "./CosmeticsSection.js";
import { HotkeysSection } from "./HotkeysSection.js";
import { SessionDefaultsSection } from "./SessionDefaultsSection.js";

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
      <SessionDefaultsSection />
      <CosmeticsSection />
      <HotkeysSection />
    </section>
  );
}
