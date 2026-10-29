/**
 * The last label seen for each chosen configuration (S47, R4.12, O-486): when the catalog no longer
 * lists a configuration the session defaults still name, the scope picker shows the words it had
 * ("Online, 6 players, 100bb deep") rather than its key.
 *
 * Mechanism: a small map from configuration id to label under its own localStorage key through
 * guarded storage (a storage failure only means the labels are not remembered), capped at the
 * scope's own cap so it never grows past what the picker can hold; a stored value is validated
 * entry by entry on read. Pure helpers return new maps.
 */
import { defaultStorage, isRecord, readJson, writeJson } from "./guarded-storage.js";
import { CONFIG_LABELS_STORAGE_KEY } from "./preference-keys.js";
import { CONFIG_ID_PATTERN, MAX_SCOPE_CONFIGS } from "./session-defaults.js";

export type ConfigLabels = Readonly<Record<string, string>>;

const MAX_LABEL_LENGTH = 120;

/** The stored labels, entry by entry; anything that is not an id to a short string is dropped. */
export function parseConfigLabels(value: unknown): ConfigLabels {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).filter(
    ([id, label]) => CONFIG_ID_PATTERN.test(id) && typeof label === "string" && label !== "" && label.length <= MAX_LABEL_LENGTH,
  );
  return Object.fromEntries(entries.slice(0, MAX_SCOPE_CONFIGS)) as ConfigLabels;
}

/** The map with these labels remembered, newest kept when the cap is reached. */
export function withConfigLabels(labels: ConfigLabels, next: ConfigLabels): ConfigLabels {
  const merged = { ...labels, ...next };
  const entries = Object.entries(merged);
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_SCOPE_CONFIGS))) as ConfigLabels;
}

export function readConfigLabels(storage: Storage | null = defaultStorage()): ConfigLabels {
  return parseConfigLabels(readJson(storage, CONFIG_LABELS_STORAGE_KEY));
}

export function rememberConfigLabels(next: ConfigLabels, storage: Storage | null = defaultStorage()): ConfigLabels {
  const merged = withConfigLabels(readConfigLabels(storage), next);
  writeJson(storage, CONFIG_LABELS_STORAGE_KEY, merged);
  return merged;
}
