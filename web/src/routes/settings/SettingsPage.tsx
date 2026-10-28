/**
 * /settings (A7 section 2): one container with a page per section (S36, R4.12, O-348, O-360). The
 * URL names the open page (/settings/<section>, sections.ts); a "Settings sections" list beside
 * the page on a wide screen, and as a scrolling row above it at phone width, moves between them.
 *
 * Pages: Session defaults and Configuration scope for automated training (S32, R4.12, O-323), the
 * read-only Hotkeys (O-327), Cosmetics (R4.14, O-323) and, for admins only, the Builder schedule
 * (S28, R3.5, O-296, O-290). A member opening the schedule's URL reads that it is for admins
 * (O-361). Session defaults and cosmetics are kept on this browser; the server owns which
 * cosmetics are unlocked.
 */
import { Link } from "@tanstack/react-router";

import { useAppApi } from "../../auth/index.js";
import { BuilderScheduleForm } from "../../components/library/BuilderScheduleForm.js";
import { Button, LoadingNote, NAV_PILL_LINK_PROPS, PageHeader, Panel, PillNav } from "../../components/ui/index.js";
import { useBuilderStatus, useIsAdmin, useSaveSettings } from "../../library/use-builder.js";
import { ConfigScopeSection } from "./ConfigScopeSection.js";
import { CosmeticsSection } from "./CosmeticsSection.js";
import { HotkeysSection } from "./HotkeysSection.js";
import { visibleSections, type SettingsSectionSlug } from "./sections.js";
import { SessionDefaultsSection } from "./SessionDefaultsSection.js";
import { SETTINGS_TEXT } from "./settings-text.js";

export const SCHEDULE_MEMBER_NOTE = SETTINGS_TEXT.scheduleMemberNote;

function ScheduleForm() {
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

function SchedulePage({ isAdmin }: { isAdmin: boolean }) {
  return <Panel>{isAdmin ? <ScheduleForm /> : <p className="text-sm text-muted">{SCHEDULE_MEMBER_NOTE}</p>}</Panel>;
}

function SectionNav({ isAdmin }: { isAdmin: boolean }) {
  return (
    <PillNav label={SETTINGS_TEXT.sections} className="md:w-56 md:shrink-0">
      {visibleSections(isAdmin).map((section) => (
        <li key={section.slug} className="shrink-0">
          <Link to="/settings/$section" params={{ section: section.slug }} {...NAV_PILL_LINK_PROPS}>
            {section.label}
          </Link>
        </li>
      ))}
    </PillNav>
  );
}

function SectionPage({ section, isAdmin }: { section: SettingsSectionSlug; isAdmin: boolean }) {
  switch (section) {
    case "session-defaults":
      return <SessionDefaultsSection />;
    case "configurations":
      return <ConfigScopeSection />;
    case "hotkeys":
      return <HotkeysSection />;
    case "cosmetics":
      return <CosmeticsSection />;
    case "builder-schedule":
      return <SchedulePage isAdmin={isAdmin} />;
  }
}

export interface SettingsPageProps {
  section: SettingsSectionSlug;
}

export function SettingsPage({ section }: SettingsPageProps) {
  const isAdmin = useIsAdmin();
  return (
    <section className="flex flex-col gap-6">
      <PageHeader title={SETTINGS_TEXT.title} description={SETTINGS_TEXT.description} />
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <SectionNav isAdmin={isAdmin} />
        <div className="min-w-0 flex-1">
          <SectionPage section={section} isAdmin={isAdmin} />
        </div>
      </div>
    </section>
  );
}
