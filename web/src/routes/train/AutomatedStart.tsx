/**
 * The start panel of automated training (S32, R4.10, O-323, O-325): one line on what a session
 * does, then what the session will use, all from the session defaults (lane C's
 * store/session-defaults.ts): the configuration scope (all covered configurations, or the ones
 * chosen in /settings, named from GET /configs), the grouping and Mixed-frequency mode, with a link to
 * /settings to change them, and Start. No seed is ever offered (a client seed makes the session
 * unrated). The names read has its own loading and error states with Try again; a failed read
 * still lets the session start, since the scope's ids are known. An id /configs does not list is
 * shown as the id.
 *
 * S38 (R3.13, O-346, O-348; screen review rows 90 and 93): both start panels are raised S36 Cards
 * with a heading and the intro as their description, the scope as a sunken block.
 * S47 (R4.10, O-487): the grouping ToggleGroup and the Mixed-frequency switch sit inline
 * (SessionDefaultsFields, writing the session defaults store) instead of a link to Settings, so
 * the roll is turned on where the session starts; the scope keeps its link.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { useAppApi } from "../../auth/index.js";
import { Button, Card, LoadingNote } from "../../components/ui/index.js";
import type { GameConfig } from "../../progress/types.js";
import { ALL_CONFIGS, type ConfigScope, type SessionDefaults } from "../../store/session-defaults.js";
import { allConfigsQuery, configLabel } from "../settings/configs-query.js";
import { SessionDefaultsFields } from "../settings/SessionDefaultsFields.js";
import { SCOPE_SETTINGS_SECTION, TRAIN_TEXT } from "./train-text.js";

export interface AutomatedStartProps {
  defaults: SessionDefaults;
  onStart: () => void;
  starting: boolean;
}

function scopeNames(ids: readonly string[], configs: readonly GameConfig[]): string[] {
  const byId = new Map(configs.map((config) => [config.config_id, config]));
  return ids.map((id) => {
    const config = byId.get(id);
    return config === undefined ? id : configLabel(config);
  });
}

function ChosenScope({ ids }: { ids: readonly string[] }) {
  const api = useAppApi();
  const configs = useQuery(allConfigsQuery(api));
  if (configs.isPending) return <LoadingNote text={TRAIN_TEXT.scopeLoading} />;
  if (configs.isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2">
        <span className="text-danger">{`${TRAIN_TEXT.scopeError} ${ids.length} chosen.`}</span>
        <Button size="sm" onClick={() => void configs.refetch()}>
          {TRAIN_TEXT.retry}
        </Button>
      </div>
    );
  }
  return (
    <ul className="list-disc pl-5" data-testid="scope-list">
      {scopeNames(ids, configs.data).map((name, index) => (
        <li key={ids[index] ?? name}>{name}</li>
      ))}
    </ul>
  );
}

function Scope({ scope }: { scope: ConfigScope }) {
  return scope === ALL_CONFIGS ? <span data-testid="scope-all">{TRAIN_TEXT.scopeAll}</span> : <ChosenScope ids={scope} />;
}

function StartRow({ label, starting, onStart }: { label: string; starting: boolean; onStart: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" size="lg" disabled={starting} onClick={onStart}>
        {label}
      </Button>
      {starting ? <LoadingNote text={TRAIN_TEXT.starting} /> : null}
    </div>
  );
}

export function AutomatedStart({ defaults, onStart, starting }: AutomatedStartProps) {
  return (
    <Card title={TRAIN_TEXT.automatedCardTitle} description={TRAIN_TEXT.automatedIntro} testId="automated-start" className="max-w-xl">
      <div className="flex flex-col gap-1 rounded-xl bg-surface-sunken px-3 py-2 text-sm">
        <span className="font-medium text-muted">{TRAIN_TEXT.scope}</span>
        <Scope scope={defaults.configScope} />
        <Link to="/settings/$section" params={{ section: SCOPE_SETTINGS_SECTION }} className="self-start font-medium text-accent underline underline-offset-2">
          {TRAIN_TEXT.changeScope}
        </Link>
      </div>
      {/* The grouping and the roll are set here, where the session starts (S47, R4.10); they write the session defaults store. */}
      <div className="flex flex-col gap-3" role="group" aria-label={TRAIN_TEXT.sessionSettings} data-testid="start-defaults">
        <SessionDefaultsFields idPrefix="automated-start" />
      </div>
      <StartRow label={TRAIN_TEXT.startAutomated} starting={starting} onStart={onStart} />
    </Card>
  );
}

export interface HoldoutStartProps {
  onStart: () => void;
  starting: boolean;
}

/** The holdout retest's start panel (O-328): what it is, and Start; its settings are the api's. */
export function HoldoutStart({ onStart, starting }: HoldoutStartProps) {
  return (
    <Card title={TRAIN_TEXT.holdoutCardTitle} description={TRAIN_TEXT.holdoutIntro} testId="holdout-start" className="max-w-xl">
      <StartRow label={TRAIN_TEXT.startHoldout} starting={starting} onStart={onStart} />
    </Card>
  );
}
