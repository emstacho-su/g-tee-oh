/**
 * Opaque pagination cursors (R3.1, A5 section 3). A cursor is the base64url JSON of the last
 * row's sort key, validated with a Zod schema on the way back in, so a tampered or stale cursor
 * is a 400 problem and never reaches SQL as anything but typed parameters.
 */
import { z } from "zod";

import { PROBLEM_SLUGS, ProblemError, HTTP_STATUS } from "./problem.js";


export function encodeCursor<Key>(key: Key): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

export function decodeCursor<Schema extends z.ZodType>(cursor: string, schema: Schema): z.infer<Schema> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw invalidCursor();
  }
  return result.data;
}

function invalidCursor(): ProblemError {
  return new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.badRequest, {
    detail: "The cursor is not one this endpoint issued.",
    errors: [{ path: "querystring.cursor", message: "invalid cursor" }],
  });
}

/**
 * Splits a page fetched with limit + 1 rows into the page and the cursor of its last row; the
 * extra row only signals that another page exists.
 */
export function paginate<Row, Key>(
  rows: readonly Row[],
  limit: number,
  keyOf: (row: Row) => Key,
): { items: Row[]; next_cursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const hasMore = rows.length > limit;
  return { items, next_cursor: hasMore && last !== undefined ? encodeCursor(keyOf(last)) : null };
}
