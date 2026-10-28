/**
 * BuilderSettingsForm (S28, R3.5, O-296, O-292, O-188): the /library settings an admin edits.
 *
 * Mechanism: each field shows the value in force (the stored override, else the builder
 * default) until it is edited. Save parses every edited field (builder-settings.ts) and stops on
 * the first invalid one, naming it; otherwise it sends a PATCH with only the keys whose value
 * differs from the one in force. The answer's stored settings replace the cached status (the
 * round trip), the edits are cleared so the fields show the stored values, and a status line says
 * the builder picks them up before its next job. A failed save shows a fixed message.
 */
import { useState, type FormEvent } from "react";

import { adminFailureText } from "../../library/admin-text.js";
import { LIBRARY_SETTING_FIELDS, numericSetting, type NumericField, type StoredSettings } from "../../library/builder-settings.js";
import type { BuilderSettingsPatch } from "../../library/queries.js";
import type { SaveSettings } from "../../library/use-builder.js";
import { Button } from "../ui/index.js";
import { currentText, NumberField, SaveOutcomeLine, type SaveOutcome } from "./SettingsFormParts.js";

export interface BuilderSettingsFormProps {
  settings: StoredSettings;
  save: SaveSettings;
}

type Edits = Readonly<Partial<Record<NumericField["key"], string>>>;

/** The patch of changed keys, or the first field's error. */
export function settingsPatch(
  fields: readonly NumericField[],
  edits: Edits,
  settings: StoredSettings,
): { patch: BuilderSettingsPatch } | { error: string; key: NumericField["key"] } {
  const entries: [string, number][] = [];
  for (const field of fields) {
    const text = edits[field.key];
    if (text === undefined) continue;
    const parsed = field.parse(text);
    if ("error" in parsed) return { error: parsed.error, key: field.key };
    if (parsed.value !== numericSetting(settings, field.key).value) entries.push([field.key, parsed.value]);
  }
  const patch: BuilderSettingsPatch = Object.fromEntries(entries);
  return { patch };
}

export function BuilderSettingsForm({ settings, save }: BuilderSettingsFormProps) {
  const [edits, setEdits] = useState<Edits>({});
  const [outcome, setOutcome] = useState<SaveOutcome>({ kind: "idle" });
  const [invalidKey, setInvalidKey] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = settingsPatch(LIBRARY_SETTING_FIELDS, edits, settings);
    if ("error" in built) {
      setInvalidKey(built.key);
      setOutcome({ kind: "failed", message: built.error });
      return;
    }
    setInvalidKey(null);
    if (Object.keys(built.patch).length === 0) {
      setOutcome({ kind: "failed", message: "Nothing changed." });
      return;
    }
    setOutcome({ kind: "saving" });
    try {
      await save(built.patch);
      setEdits({});
      setOutcome({ kind: "saved" });
    } catch (error: unknown) {
      setOutcome({ kind: "failed", message: adminFailureText(error) });
    }
  }

  return (
    <form aria-labelledby="builder-settings-heading" onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" noValidate>
      <h2 id="builder-settings-heading" className="text-lg font-semibold">
        Builder settings
      </h2>
      <div className="flex flex-wrap gap-4">
        {LIBRARY_SETTING_FIELDS.map((field) => {
          const inForce = numericSetting(settings, field.key);
          return (
            <NumberField
              key={field.key}
              label={field.label}
              hint={field.hint}
              value={edits[field.key] ?? field.toInput(inForce.value)}
              current={currentText(field.toInput(inForce.value), inForce.stored)}
              invalid={invalidKey === field.key}
              onChange={(text) => setEdits((previous) => ({ ...previous, [field.key]: text }))}
            />
          );
        })}
      </div>
      <Button type="submit" variant="primary" className="self-start" disabled={outcome.kind === "saving"}>
        Save builder settings
      </Button>
      <SaveOutcomeLine outcome={outcome} />
    </form>
  );
}
