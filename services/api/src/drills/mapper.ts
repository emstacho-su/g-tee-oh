/**
 * Drill row to API shape (R3.14, A5 section 3). The column trainer_settings is the API field
 * trainer, timestamps leave as ISO strings, and user_id never leaves the server (ADR 0001).
 *
 * Mechanism: the jsonb columns are parsed with the same Zod schemas that guard the request body,
 * so a row that no longer matches the contract (a hand edit, a schema change without a data
 * migration) fails loudly as a 500 with the cause in the log, instead of serving a drill the
 * client cannot read.
 */
import { spotFilterSchema, trainerSettingsSchema, type Drill } from "../schemas/drills.js";
import type { DrillRow } from "./repository.js";

export function toDrill(row: DrillRow): Drill {
  return {
    id: row.id,
    name: row.name,
    tags: [...row.tags],
    spot_filter: spotFilterSchema.parse(row.spot_filter),
    trainer: trainerSettingsSchema.parse(row.trainer_settings),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
