/**
 * The configuration scope of the session defaults (S32, R4.12, O-323, O-325): all covered
 * configurations, or a chosen list of 1 to 32 (the api's cap on config_ids) from GET /configs.
 *
 * Mechanism: the radio choice is local state started from the store, because "only the ones I
 * choose" with nothing ticked is a valid moment on screen but not a valid stored scope; while
 * nothing is ticked the store holds "all" and a note says so. Each tick writes the new list to the
 * store at once, in the catalog's order. At the cap the unticked boxes are disabled with a note.
 * Saved ids the catalog no longer offers are named and can be removed; they are kept until then,
 * so a catalog read that is briefly short never drops a choice on its own.
 */
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import { useAppApi } from "../../auth/index.js";
import { Button, LoadingNote } from "../../components/ui/index.js";
import type { GameConfig } from "../../progress/types.js";
import { ALL_CONFIGS, MAX_SCOPE_CONFIGS, useSessionDefaultsStore } from "../../store/index.js";
import { LoadError } from "../home-cards/LoadError.js";
import { allConfigsQuery, configLabel } from "./configs-query.js";
import { scopeCapText, SESSION_DEFAULTS_TEXT, staleConfigsText } from "./settings-text.js";

type ScopeMode = "all" | "chosen";

export interface ConfigScopePickerProps {
  onSaved: () => void;
}

interface ConfigListProps {
  configs: readonly GameConfig[];
  chosen: readonly string[];
  onChange: (next: readonly string[]) => void;
}

function ConfigList({ configs, chosen, onChange }: ConfigListProps) {
  const offered = new Set(configs.map((config) => config.config_id));
  const stale = chosen.filter((id) => !offered.has(id));
  const atCap = chosen.length >= MAX_SCOPE_CONFIGS;
  const toggle = (id: string, on: boolean): void => {
    const picked = new Set(on ? [...chosen, id] : chosen.filter((each) => each !== id));
    onChange([...stale.filter((each) => picked.has(each)), ...configs.map((config) => config.config_id).filter((each) => picked.has(each))]);
  };
  if (configs.length === 0) return <p className="text-sm text-muted">{SESSION_DEFAULTS_TEXT.noConfigs}</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label={SESSION_DEFAULTS_TEXT.chooseList} className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
        {configs.map((config) => {
          const checked = chosen.includes(config.config_id);
          return (
            <li key={config.config_id}>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && atCap}
                  onChange={(event) => toggle(config.config_id, event.target.checked)}
                  className="h-4 w-4"
                />
                {configLabel(config)}
              </label>
            </li>
          );
        })}
      </ul>
      {atCap ? <p className="text-sm text-muted">{scopeCapText(MAX_SCOPE_CONFIGS)}</p> : null}
      {stale.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p className="text-warning">{staleConfigsText(stale)}</p>
          <Button size="sm" onClick={() => onChange(chosen.filter((id) => offered.has(id)))}>
            {SESSION_DEFAULTS_TEXT.removeStale}
          </Button>
        </div>
      )}
    </div>
  );
}

function ChosenConfigs({ chosen, onChange }: { chosen: readonly string[]; onChange: (next: readonly string[]) => void }) {
  const configs = useQuery(allConfigsQuery(useAppApi()));
  if (configs.data !== undefined) return <ConfigList configs={configs.data} chosen={chosen} onChange={onChange} />;
  if (configs.isError) {
    return <LoadError message={SESSION_DEFAULTS_TEXT.configsFailed} retries="the configurations" onRetry={() => void configs.refetch()} />;
  }
  return <LoadingNote text={SESSION_DEFAULTS_TEXT.loadingConfigs} />;
}

export function ConfigScopePicker({ onSaved }: ConfigScopePickerProps) {
  const scope = useSessionDefaultsStore((state) => state.defaults.configScope);
  const setConfigScope = useSessionDefaultsStore((state) => state.setConfigScope);
  const [mode, setMode] = useState<ScopeMode>(scope === ALL_CONFIGS ? "all" : "chosen");
  const name = useId();
  const chosen = scope === ALL_CONFIGS ? [] : scope;
  const choose = (next: ScopeMode): void => {
    setMode(next);
    if (next === "all" && scope !== ALL_CONFIGS) {
      setConfigScope(ALL_CONFIGS);
      onSaved();
    }
  };
  const change = (next: readonly string[]): void => {
    setConfigScope(next.length === 0 ? ALL_CONFIGS : next);
    onSaved();
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{SESSION_DEFAULTS_TEXT.scopeLegend}</legend>
      {(["all", "chosen"] as const).map((value) => (
        <label key={value} className="inline-flex items-center gap-2 text-sm">
          <input type="radio" name={name} value={value} checked={mode === value} onChange={() => choose(value)} className="h-4 w-4" />
          {value === "all" ? SESSION_DEFAULTS_TEXT.scopeAll : SESSION_DEFAULTS_TEXT.scopeChosen}
        </label>
      ))}
      {mode === "chosen" ? (
        <>
          {chosen.length === 0 ? <p className="text-sm text-muted">{SESSION_DEFAULTS_TEXT.noneChosen}</p> : null}
          <ChosenConfigs chosen={chosen} onChange={change} />
        </>
      ) : null}
    </fieldset>
  );
}
