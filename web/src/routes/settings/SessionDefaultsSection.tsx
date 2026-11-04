/**
 * The Session defaults section of /settings (S32, S36, S37, R4.12, O-323, O-325, O-344, O-360):
 * grouping and Mixed-frequency mode (off by default; the stored field keeps the wire name rng) for
 * the /train start screen. Each change is saved to the session defaults store at once and a status
 * line says so; a seed is never offered. The two controls are SessionDefaultsFields (S47), which
 * the automated start panel renders inline as well. The configuration scope has its own page since
 * S36 (ConfigScopeSection, O-360).
 */
import { useState } from "react";

import { SessionDefaultsFields } from "./SessionDefaultsFields.js";
import { SESSION_DEFAULTS_TEXT } from "./settings-text.js";
import { SettingsSection } from "./SettingsSection.js";

export function SessionDefaultsSection() {
  const [saved, setSaved] = useState(false);
  return (
    <SettingsSection title={SESSION_DEFAULTS_TEXT.title} description={SESSION_DEFAULTS_TEXT.description}>
      <SessionDefaultsFields onSaved={() => setSaved(true)} />
      <p role="status" className="text-sm text-success">
        {saved ? SESSION_DEFAULTS_TEXT.saved : ""}
      </p>
    </SettingsSection>
  );
}
