/**
 * The study settings panel and its summary (S39, R3.12, O-354, O-390, O-392). The panel asks for
 * the spot before any solution shows: six segmented choices from the catalog (format, table size,
 * stake with its rake, depth, the seat that acts first and its opponent), then Confirm. Each field
 * renders its state from fieldStates: its choices, or the one reason it waits (the upper field
 * missing or unavailable, the catalog loading, the seats loading or failed); an unavailable choice
 * stays listed, focusable and announced with its reason (ToggleGroup's aria-disabled items). Confirm is
 * a real disabled button until the six choices name a covered spot, with the actual reason
 * written beside it (confirmBlocker: still loading, a field left empty, or which chosen value is
 * unavailable and why). The notice names an uncovered pair the draft's seats point at, and a
 * failed read of the draft's seats shows here with a retry, never over a confirmed solution. Once
 * a spot is confirmed the panel folds into a one-line summary with "Change settings". The
 * component holds no state: the caller owns the draft and the URL.
 */
import { Button, Card, Panel, ToggleGroup } from "../../components/ui/index.js";
import { catalogFailure } from "../../study/problem-text.js";
import { FailureAlert } from "./StudyNotices.js";
import { SETTING_KEYS, SETTING_LABELS, type FieldState, type FieldStates, type SettingKey, type SettingsDraft } from "../../study/settings.js";

export const PANEL_TEXT = {
  title: "Spot settings",
  description: "Choose the settings, then Confirm.",
  confirm: "Confirm",
  cancel: "Cancel",
  change: "Change settings",
} as const;

export interface StudySettingsPanelProps {
  /** Each field's choices or the reason it waits (fieldStates), computed once per draft. */
  fields: FieldStates;
  draft: SettingsDraft;
  /** Why Confirm is unavailable; undefined when the choices name a covered spot. */
  blocker: string | undefined;
  /** Shown above the fields, for example when the draft's seats name an uncovered pair. */
  notice?: string;
  /** A failed read of the draft's seats, retried in place. */
  seatsFailure?: { onRetry: () => void };
  onChange: (key: SettingKey, raw: string) => void;
  onConfirm: () => void;
  /** Offered only when a confirmed spot is behind the panel. */
  onCancel?: () => void;
}

interface SettingFieldProps {
  name: SettingKey;
  state: FieldState;
  value: string | undefined;
  onChange: (key: SettingKey, raw: string) => void;
}

function SettingField({ name, state, value, onChange }: SettingFieldProps) {
  const label = SETTING_LABELS[name];
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span aria-hidden="true" className="text-sm font-medium">
        {label}
      </span>
      {state.kind === "waiting" ? (
        <p className="text-sm text-muted">{state.reason}</p>
      ) : (
        <ToggleGroup label={label} value={value} options={state.choices} onValueChange={(next) => onChange(name, next)} wrap />
      )}
    </div>
  );
}

export function StudySettingsPanel(props: StudySettingsPanelProps) {
  const { fields, draft, blocker, notice, seatsFailure, onChange, onConfirm, onCancel } = props;
  return (
    <Card title={PANEL_TEXT.title} description={PANEL_TEXT.description}>
      {notice === undefined ? null : (
        <p role="status" className="text-sm font-medium">
          {notice}
        </p>
      )}
      {seatsFailure === undefined ? null : <FailureAlert failure={catalogFailure()} onRetry={seatsFailure.onRetry} />}
      <div className="grid gap-3 md:grid-cols-2">
        {SETTING_KEYS.map((key) => (
          <SettingField
            key={key}
            name={key}
            state={fields[key]}
            value={draft[key] === undefined ? undefined : String(draft[key])}
            onChange={onChange}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={blocker !== undefined} onClick={onConfirm}>
          {PANEL_TEXT.confirm}
        </Button>
        {onCancel === undefined ? null : <Button onClick={onCancel}>{PANEL_TEXT.cancel}</Button>}
        {blocker === undefined ? null : <span className="text-sm text-muted">{blocker}</span>}
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
