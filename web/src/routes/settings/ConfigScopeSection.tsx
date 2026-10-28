/**
 * The Configuration scope page of /settings (S36, R4.12, O-323, O-325, O-360): which game
 * configurations automated sessions draw from, all covered ones or a chosen list. It moved out of
 * Session defaults into its own page; the picker itself (ConfigScopePicker) is unchanged. Each
 * change is saved to the session defaults store at once and the status line says so.
 */
import { useState } from "react";

import { ConfigScopePicker } from "./ConfigScopePicker.js";
import { CONFIG_SCOPE_TEXT, SESSION_DEFAULTS_TEXT } from "./settings-text.js";
import { SettingsSection } from "./SettingsSection.js";

export function ConfigScopeSection() {
  const [saved, setSaved] = useState(false);
  return (
    <SettingsSection title={CONFIG_SCOPE_TEXT.title} description={CONFIG_SCOPE_TEXT.description}>
      <ConfigScopePicker onSaved={() => setSaved(true)} />
      <p role="status" className="text-sm text-success">
        {saved ? SESSION_DEFAULTS_TEXT.saved : ""}
      </p>
    </SettingsSection>
  );
}
