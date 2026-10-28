/**
 * The start panel of automated training (S32, R4.10, O-323, O-325): one line on what a session
 * does, then what the session will use, all from the session defaults (lane C's
 * store/session-defaults.ts): the configuration scope (all covered configurations, or the ones
 * chosen in /settings, named from GET /configs), the grouping and RNG mode, with a link to
 * /settings to change them, and Start. No seed is ever offered (a client seed makes the session
 * unrated). The names read has its own loading and error states with Try again; a failed read
 * still lets the session start, since the scope's ids are known. An id /configs does not list is
 * shown as the id.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { useAppApi } from "../../auth/index.js";
import { Button, LoadingNote } from "../../components/ui/index.js";
import { GROUPING_LABELS } from "../../drills/labels.js";
import type { GameConfig } from "../../progress/types.js";
import { ALL_CONFIGS, type ConfigScope, type SessionDefaults } from "../../store/session-defaults.js";
import { allConfigsQuery, configLabel } from "../settings/configs-query.js";
import { DEFAULTS_SETTINGS_SECTION, SCOPE_SETTINGS_SECTION, TRAIN_TEXT } from "./train-text.js";

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

export function AutomatedStart({ defaults, onStart, starting }: AutomatedStartProps) {
  return (
    <section aria-label="Start automated training" data-testid="automated-start" className="flex max-w-xl flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4">
      <p>{TRAIN_TEXT.automatedIntro}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">{TRAIN_TEXT.scope}</dt>
        <dd>
          <Scope scope={defaults.configScope} />
        </dd>
        <dt className="text-muted">{TRAIN_TEXT.grouping}</dt>
        <dd data-testid="start-grouping">{GROUPING_LABELS[defaults.grouping]}</dd>
        <dt className="text-muted">{TRAIN_TEXT.rng}</dt>
        <dd data-testid="start-rng">{defaults.rng ? TRAIN_TEXT.on : TRAIN_TEXT.off}</dd>
      </dl>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
        <Link to="/settings/$section" params={{ section: SCOPE_SETTINGS_SECTION }} className="underline">
          {TRAIN_TEXT.changeScope}
        </Link>
        <Link to="/settings/$section" params={{ section: DEFAULTS_SETTINGS_SECTION }} className="underline">
          {TRAIN_TEXT.changeDefaults}
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" size="lg" disabled={starting} onClick={onStart}>
          {TRAIN_TEXT.startAutomated}
        </Button>
        {starting ? <LoadingNote text={TRAIN_TEXT.starting} /> : null}
      </div>
    </section>
  );
}

export interface HoldoutStartProps {
  onStart: () => void;
  starting: boolean;
}

/** The holdout retest's start panel (O-328): what it is, and Start; its settings are the api's. */
export function HoldoutStart({ onStart, starting }: HoldoutStartProps) {
  return (
    <section aria-label="Start the holdout retest" data-testid="holdout-start" className="flex max-w-xl flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4">
      <p>{TRAIN_TEXT.holdoutIntro}</p>
      <div className="flex items-center gap-3">
        <Button variant="primary" size="lg" disabled={starting} onClick={onStart}>
          {TRAIN_TEXT.startHoldout}
        </Button>
        {starting ? <LoadingNote text={TRAIN_TEXT.starting} /> : null}
      </div>
    </section>
  );
}
