/**
 * The Session defaults section of /settings (S32, S37, R4.12, O-323, O-325, O-344): grouping,
 * Mixed-frequency mode (off by default; the stored field keeps the wire name rng) and
 * the configuration scope the /train start screen offers first. Each change is saved to the
 * session defaults store at once and a status line says so; a seed is never offered.
 *
 * Mechanism: grouping is a ToggleGroup and the mode a checkbox, both written straight to the store. The
 * scope is all covered configurations or a chosen list (ConfigScopePicker) from GET /configs.
 */
import { useState } from "react";

import { ToggleGroup } from "../../components/ui/index.js";
import type { Grouping } from "../../contracts.js";
import { GROUPINGS, useSessionDefaultsStore } from "../../store/index.js";
import { SESSION_TEXT } from "../drill-run/labels.js";
import { ConfigScopePicker } from "./ConfigScopePicker.js";
import { GROUPING_LABELS } from "../../drills/labels.js";
import { SESSION_DEFAULTS_TEXT } from "./settings-text.js";
import { SettingsSection } from "./SettingsSection.js";

const GROUPING_OPTIONS = GROUPINGS.map((value) => ({ value, label: GROUPING_LABELS[value] }));
const RNG_HINT_ID = "session-defaults-rng-hint";

export function SessionDefaultsSection() {
  const defaults = useSessionDefaultsStore((state) => state.defaults);
  const setGrouping = useSessionDefaultsStore((state) => state.setGrouping);
  const setRng = useSessionDefaultsStore((state) => state.setRng);
  const [saved, setSaved] = useState(false);
  const saving = <T,>(apply: (value: T) => void) => (value: T): void => {
    apply(value);
    setSaved(true);
  };
  return (
    <SettingsSection title={SESSION_DEFAULTS_TEXT.title} description={SESSION_DEFAULTS_TEXT.description}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium" aria-hidden="true">
          {SESSION_DEFAULTS_TEXT.grouping}
        </span>
        <ToggleGroup<Grouping> label={SESSION_DEFAULTS_TEXT.grouping} value={defaults.grouping} options={GROUPING_OPTIONS} onValueChange={saving(setGrouping)} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="inline-flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={defaults.rng}
            aria-describedby={RNG_HINT_ID}
            onChange={(event) => saving(setRng)(event.target.checked)}
            className="h-4 w-4"
          />
          {SESSION_TEXT.rngSwitch}
        </label>
        <p id={RNG_HINT_ID} className="text-sm text-muted">
          {SESSION_TEXT.rngHint}
        </p>
      </div>
      <ConfigScopePicker onSaved={() => setSaved(true)} />
      <p role="status" className="text-sm text-success">
        {saved ? SESSION_DEFAULTS_TEXT.saved : ""}
      </p>
    </SettingsSection>
  );
}
