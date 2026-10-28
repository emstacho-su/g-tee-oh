/**
 * The study filters (S25, R3.12, O-286): five labeled selects, format, table size, stake, depth
 * and pair, each enabled once the filter above it is chosen and its options have loaded. Options
 * come from the catalog (filters.ts); pairs the library does not cover are disabled options
 * labeled "Not in the library". Each change goes to the caller as (filter, raw value), which
 * writes the URL; this component holds no state of its own.
 */
import { useId } from "react";

import {
  FORMAT_OPTIONS,
  depthOptions,
  pairOptions,
  stakeOptions,
  tableSizeOptions,
  type FilterKey,
  type SelectOption,
} from "../../study/filters.js";
import type { StudySearch } from "../../study/search.js";
import type { StudyCatalog } from "../../study/use-study-catalog.js";

export interface StudyFiltersProps {
  search: StudySearch;
  catalog: StudyCatalog;
  onFilterChange: (key: FilterKey, raw: string) => void;
}

interface FilterSelectProps {
  label: string;
  filter: FilterKey;
  value: string | number | undefined;
  /** Undefined while the filter above is unchosen or the options are loading. */
  options: readonly SelectOption[] | undefined;
  onFilterChange: (key: FilterKey, raw: string) => void;
}

function FilterSelect({ label, filter, value, options, onFilterChange }: FilterSelectProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value === undefined ? "" : String(value)}
        disabled={options === undefined}
        onChange={(event) => onFilterChange(filter, event.target.value)}
        className="h-9 min-w-32 rounded-md border border-border bg-surface-raised px-2 disabled:opacity-50"
      >
        <option value="">{`Choose ${label.toLowerCase()}`}</option>
        {(options ?? []).map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled === true}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Options for each select, undefined while the select must stay disabled. */
function filterOptions(search: StudySearch, catalog: StudyCatalog) {
  const { configs, stakes, pairs, configId } = catalog;
  const tableSize = search.table_size;
  const stake = search.stake;
  return {
    tableSizes: configs === undefined ? undefined : tableSizeOptions(configs),
    stakes: configs === undefined || stakes === undefined || tableSize === undefined ? undefined : stakeOptions(stakes, configs, tableSize),
    depths: configs === undefined || tableSize === undefined || stake === undefined ? undefined : depthOptions(configs, tableSize, stake),
    pairs: configId === undefined || pairs === undefined ? undefined : pairOptions(pairs),
  };
}

export function StudyFilters({ search, catalog, onFilterChange }: StudyFiltersProps) {
  const options = filterOptions(search, catalog);
  return (
    <div role="group" aria-label="Study filters" className="flex flex-wrap gap-3">
      <FilterSelect label="Format" filter="format" value={search.format} options={FORMAT_OPTIONS} onFilterChange={onFilterChange} />
      <FilterSelect label="Table size" filter="table_size" value={search.table_size} options={options.tableSizes} onFilterChange={onFilterChange} />
      <FilterSelect label="Stake" filter="stake" value={search.stake} options={options.stakes} onFilterChange={onFilterChange} />
      <FilterSelect label="Depth" filter="depth" value={search.depth} options={options.depths} onFilterChange={onFilterChange} />
      <FilterSelect label="Pair" filter="pair" value={search.pair} options={options.pairs} onFilterChange={onFilterChange} />
    </div>
  );
}
