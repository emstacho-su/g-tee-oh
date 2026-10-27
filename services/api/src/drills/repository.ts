/**
 * Drill rows (R3.14, A4 drill table, ADR 0001). Every query is scoped by user_id as well as the
 * drill id, so another user's drill is simply not found: the api answers 404, never 403, and never
 * reveals that the id exists.
 *
 * Mechanism: the API field trainer is stored in the trainer_settings column and spot_filter in
 * spot_filter, both jsonb, written as JSON text cast to jsonb so the pg driver never guesses the
 * encoding; tags is a text[] filtered with array containment (tags @> array[tag]). Lists are
 * keyset pages by id descending: drill ids are uuidv7, so id order is creation order and the
 * newest drill comes first. Rows are mapped to the Drill shape in drills/mapper.ts. A delete that
 * a practice_session still references fails with a foreign key violation (SQLSTATE 23503), which
 * is reported as "in_use" so the route can answer 409 instead of 500.
 */
import { sql, type RawBuilder, type Selectable } from "kysely";

import type { DB } from "@g-tee-oh/contracts";

import type { Database } from "../db.js";
import { PG_ERROR, pgErrorCode } from "../http/problem.js";
import type { DrillCreateBody, DrillPatchBody } from "../schemas/drills.js";

export type DrillRow = Selectable<DB["drill"]>;
type Json = DrillRow["spot_filter"];

export type DeleteOutcome = "deleted" | "not_found" | "in_use";

export interface DrillListQuery {
  tag?: string | undefined;
  beforeId?: string | undefined;
  fetch: number;
}

const DRILL_COLUMNS = ["id", "user_id", "name", "tags", "spot_filter", "trainer_settings", "created_at", "updated_at"] as const;

function toJsonb(value: unknown): RawBuilder<Json> {
  return sql<Json>`cast(${JSON.stringify(value)} as jsonb)`;
}

export async function listDrills(database: Database, userId: string, query: DrillListQuery): Promise<DrillRow[]> {
  const { tag, beforeId } = query;
  return database
    .selectFrom("drill")
    .select(DRILL_COLUMNS)
    .where((eb) =>
      eb.and([
        eb("user_id", "=", userId),
        ...(tag === undefined ? [] : [eb("tags", "@>", sql<string[]>`array[${tag}]::text[]`)]),
        ...(beforeId === undefined ? [] : [eb("id", "<", beforeId)]),
      ]),
    )
    .orderBy("id", "desc")
    .limit(query.fetch)
    .execute();
}

export async function findDrill(database: Database, userId: string, id: string): Promise<DrillRow | undefined> {
  return database
    .selectFrom("drill")
    .select(DRILL_COLUMNS)
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .executeTakeFirst();
}

export async function insertDrill(database: Database, userId: string, body: DrillCreateBody): Promise<DrillRow> {
  return database
    .insertInto("drill")
    .values({
      user_id: userId,
      name: body.name,
      tags: body.tags,
      spot_filter: toJsonb(body.spot_filter),
      trainer_settings: toJsonb(body.trainer),
    })
    .returning(DRILL_COLUMNS)
    .executeTakeFirstOrThrow();
}

/** Sets only the fields the patch carries, plus updated_at; undefined when not the user's drill. */
export async function updateDrill(
  database: Database,
  userId: string,
  id: string,
  patch: DrillPatchBody,
): Promise<DrillRow | undefined> {
  return database
    .updateTable("drill")
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.tags === undefined ? {} : { tags: patch.tags }),
      ...(patch.spot_filter === undefined ? {} : { spot_filter: toJsonb(patch.spot_filter) }),
      ...(patch.trainer === undefined ? {} : { trainer_settings: toJsonb(patch.trainer) }),
      updated_at: sql<Date>`now()`,
    })
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .returning(DRILL_COLUMNS)
    .executeTakeFirst();
}

export async function deleteDrill(database: Database, userId: string, id: string): Promise<DeleteOutcome> {
  try {
    const result = await database
      .deleteFrom("drill")
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n ? "deleted" : "not_found";
  } catch (error: unknown) {
    if (pgErrorCode(error) === PG_ERROR.foreignKeyViolation) {
      return "in_use";
    }
    throw error;
  }
}
