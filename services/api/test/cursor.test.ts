/**
 * Opaque pagination cursors (R3.1, A5 section 3). Unit tests of http/cursor.ts: a cursor round
 * trips through base64url JSON and its Zod schema; anything the server did not issue (bad base64,
 * bad JSON, the wrong shape) is a 400 problem; paginate, given limit + 1 rows, cuts the page and
 * sets next_cursor only while another page exists.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { decodeCursor, encodeCursor, paginate } from "../src/http/cursor.js";
import { ProblemError } from "../src/http/problem.js";

const keySchema = z.object({ created_at: z.iso.datetime(), id: z.uuid() });
type Key = z.infer<typeof keySchema>;

const KEY: Key = { created_at: "2026-10-27T12:00:00.000Z", id: "0199f0a0-0000-7000-8000-000000000001" };

function expectInvalidCursor(cursor: string): void {
  let caught: unknown;
  try {
    decodeCursor(cursor, keySchema);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ProblemError);
  expect(caught).toMatchObject({ status: 400, slug: "bad-request" });
}

describe("R3.1 cursor codec", () => {
  it("R3.1 a cursor round trips to the same key", () => {
    const cursor = encodeCursor(KEY);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, keySchema)).toEqual(KEY);
  });

  it("R3.1 a cursor that is not base64url JSON is a 400 problem", () => {
    expectInvalidCursor("%%%not-base64%%%");
    expectInvalidCursor(Buffer.from("{not json", "utf8").toString("base64url"));
  });

  it("R3.1 a cursor with the wrong shape is a 400 problem", () => {
    expectInvalidCursor(encodeCursor({ id: "not-a-uuid" }));
    expectInvalidCursor(encodeCursor([KEY.created_at, KEY.id]));
    expectInvalidCursor(encodeCursor(null));
  });

  it("R3.1 paginate sets next_cursor from the last row while another page exists", () => {
    const rows = [1, 2, 3].map((n) => ({ n }));

    const page = paginate(rows, 2, (row) => ({ n: row.n }));

    expect(page.items).toEqual([{ n: 1 }, { n: 2 }]);
    expect(page.next_cursor).toBe(encodeCursor({ n: 2 }));
  });

  it("R3.1 paginate's next_cursor is null on the last page", () => {
    expect(paginate([{ n: 1 }, { n: 2 }], 2, (row) => row).next_cursor).toBeNull();
    expect(paginate([], 2, (row: { n: number }) => row)).toEqual({ items: [], next_cursor: null });
  });

  it("R3.1 paginate does not mutate the rows it is given", () => {
    const rows = Object.freeze([{ n: 1 }, { n: 2 }, { n: 3 }]);

    paginate(rows, 1, (row) => row);

    expect(rows).toHaveLength(3);
  });
});
