/**
 * The study settings panel and its summary (S39, R3.12, O-354, O-390, O-392). The panel asks for
 * the spot before any solution shows: six segmented choices from the catalog (format, table size,
 * stake with its rake, depth, the seat that acts first and its opponent), then Confirm. A field
 * waits with a short prompt until the fields above it are chosen; an unavailable choice stays
 * listed, focusable and announced with its reason (ToggleGroup's aria-disabled items). Confirm is
 * a real disabled button until the six choices name a covered spot, with the reason written
 * beside it. Once a spot is confirmed the panel folds into a one-line summary with "Change
 * settings". The component holds no state: the caller owns the draft and the URL.
 */
import { Button, Card, LoadingNote, Panel, ToggleGroup } from "../../components/ui/index.js";
import {
  SETTING_KEYS,
  SETTING_LABELS,
  SETTING_PROMPTS,
  type SettingChoice,
  type SettingChoices,
  type SettingKey,
  type SettingsDraft,
} from "../../study/settings.js";

export const PANEL_TEXT = {
  title: "Spot settings",
  description: "Choose the settings, then Confirm.",
  confirm: "Confirm",
  cancel: "Cancel",
  change: "Change settings",
  incomplete: "Choose every setting to confirm.",
  loading: "Loading the catalog.",
} as const;

export interface StudySettingsPanelProps {
  /** Undefined while the catalog loads. */
  choices: SettingChoices | undefined;
  draft: SettingsDraft;
  confirmable: boolean;
  /** Shown above the fields, for example when the URL names an uncovered pair. */
  notice?: string;
  onChange: (key: SettingKey, raw: string) => void;
  onConfirm: () => void;
  /** Offered only when a confirmed spot is behind the panel. */
  onCancel?: () => void;
}

interface SettingFieldProps {
  name: SettingKey;
  choices: readonly SettingChoice[] | undefined;
  value: string | undefined;
  onChange: (key: SettingKey, raw: string) => void;
}

function SettingField({ name, choices, value, onChange }: SettingFieldProps) {
  const label = SETTING_LABELS[name];
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span aria-hidden="true" className="text-sm font-medium">
        {label}
      </span>
      {choices === undefined ? (
        <p className="text-sm text-muted">{SETTING_PROMPTS[name]}</p>
      ) : (
        <ToggleGroup label={label} value={value} options={choices} onValueChange={(next) => onChange(name, next)} wrap />
      )}
    </div>
  );
}

export function StudySettingsPanel({ choices, draft, confirmable, notice, onChange, onConfirm, onCancel }: StudySettingsPanelProps) {
  return (
    <Card title={PANEL_TEXT.title} description={PANEL_TEXT.description}>
      {notice === undefined ? null : (
        <p role="status" className="text-sm font-medium">
          {notice}
        </p>
      )}
      {choices === undefined ? <LoadingNote text={PANEL_TEXT.loading} /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {SETTING_KEYS.map((key) => (
          <SettingField
            key={key}
            name={key}
            choices={choices?.[key]}
            value={draft[key] === undefined ? undefined : String(draft[key])}
            onChange={onChange}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!confirmable} onClick={onConfirm}>
          {PANEL_TEXT.confirm}
        </Button>
        {onCancel === undefined ? null : <Button onClick={onCancel}>{PANEL_TEXT.cancel}</Button>}
        {confirmable ? null : <span className="text-sm text-muted">{PANEL_TEXT.incomplete}</span>}
      </div>
    </Card>
  );
}

export interface SettingsSummaryProps {
  summary: string;
  onChange: () => void;
}

export function SettingsSummary({ summary, onChange }: SettingsSummaryProps) {
  return (
    <Panel className="flex-row flex-wrap items-center justify-between">
      <p className="text-sm font-medium">{summary}</p>
      <Button size="sm" onClick={onChange}>
        {PANEL_TEXT.change}
      </Button>
    </Panel>
  );
}
