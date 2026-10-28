/**
 * The table choice of the practice pickers (S41, R3.16, R3.17, O-415): a labelled select on the
 * shared field class over the served configurations, each named by settings' configLabel ("Online,
 * 6 players, 100 bb deep, stakes online"), so the quiz and painting pickers name a table the same
 * way the Session defaults section does.
 */
import { useId } from "react";

import type { GameConfig } from "../../progress/types.js";
import { configLabel } from "../../routes/settings/configs-query.js";
import { FIELD_CLASS, cn } from "../ui/index.js";

export interface TableSelectProps {
  label: string;
  configs: readonly GameConfig[];
  value: string | null;
  onChange: (configId: string) => void;
}

export function TableSelect({ label, configs, value, onChange }: TableSelectProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value)} className={cn(FIELD_CLASS, "h-10 max-w-full px-2 text-sm sm:max-w-md")}>
        {configs.map((config) => (
          <option key={config.config_id} value={config.config_id}>
            {configLabel(config)}
          </option>
        ))}
      </select>
    </div>
  );
}
