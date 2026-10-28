/**
 * BuilderScheduleForm (S28, R3.5, O-296, O-13): the builder schedule part of /settings, the
 * overnight window in which the builder may use a larger CPU share. The window is stored as one
 * setting (overnight: start_hour, end_hour, utc_offset_minutes, cpu_share), so a save sends the
 * whole window through PATCH /admin/builder/settings when any part differs from the one in force.
 * The answer's stored settings replace the cached status and the fields show them.
 */
import { useState, type FormEvent } from "react";

import { adminFailureText } from "../../library/admin-text.js";
import {
  OVERNIGHT_FIELDS,
  overnightSetting,
  overnightTexts,
  parseOvernight,
  sameWindow,
  type OvernightKey,
  type OvernightTexts,
  type StoredSettings,
} from "../../library/builder-settings.js";
import { formatHour } from "../../library/format.js";
import type { SaveSettings } from "../../library/use-builder.js";
import { Button } from "../ui/index.js";
import { currentText, NumberField, SaveOutcomeLine, type SaveOutcome } from "./SettingsFormParts.js";

export interface BuilderScheduleFormProps {
  settings: StoredSettings;
  save: SaveSettings;
}

export function BuilderScheduleForm({ settings, save }: BuilderScheduleFormProps) {
  const inForce = overnightSetting(settings);
  const [edits, setEdits] = useState<Partial<OvernightTexts>>({});
  const [outcome, setOutcome] = useState<SaveOutcome>({ kind: "idle" });
  const [invalidKey, setInvalidKey] = useState<OvernightKey | null>(null);
  const shown: OvernightTexts = { ...overnightTexts(inForce.value), ...edits };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseOvernight(shown);
    if ("error" in parsed) {
      setInvalidKey(parsed.key);
      setOutcome({ kind: "failed", message: parsed.error });
      return;
    }
    setInvalidKey(null);
    if (sameWindow(parsed.value, inForce.value)) {
      setOutcome({ kind: "failed", message: "Nothing changed." });
      return;
    }
    setOutcome({ kind: "saving" });
    try {
      await save({ overnight: parsed.value });
      setEdits({});
      setOutcome({ kind: "saved" });
    } catch (error: unknown) {
      setOutcome({ kind: "failed", message: adminFailureText(error) });
    }
  }

  const active = inForce.value;
  const summary = `${formatHour(active.start_hour)} to ${formatHour(active.end_hour)} at UTC offset ${active.utc_offset_minutes} minutes, CPU share ${active.cpu_share}`;
  return (
    <form aria-labelledby="builder-schedule-heading" onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" noValidate>
      <h2 id="builder-schedule-heading" className="text-lg font-semibold">
        Builder schedule
      </h2>
      <p className="text-sm text-muted">{currentText(summary, inForce.stored)}</p>
      <div className="flex flex-wrap gap-4">
        {OVERNIGHT_FIELDS.map((field) => (
          <NumberField
            key={field.key}
            label={field.label}
            hint={field.hint}
            value={shown[field.key]}
            current={currentText(overnightTexts(active)[field.key], inForce.stored)}
            invalid={invalidKey === field.key}
            step={field.integer ? "1" : "any"}
            onChange={(text) => setEdits((previous) => ({ ...previous, [field.key]: text }))}
          />
        ))}
      </div>
      <Button type="submit" variant="primary" className="self-start" disabled={outcome.kind === "saving"}>
        Save the schedule
      </Button>
      <SaveOutcomeLine outcome={outcome} />
    </form>
  );
}
