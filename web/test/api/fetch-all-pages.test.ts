// fetchAllPages (S32, R4.12): follows next_cursor from the first page, concatenates the items in
// page order without changing any page, and fails loudly when the cursor does not end within the
// page budget. Used by the tracks read and the configuration list.
import { describe, expect, it, vi } from "vitest";

import { fetchAllPages, type CursorPage } from "../../src/api/fetch-all-pages.js";

function pages(...chunks: readonly (readonly number[])[]): (cursor: string | undefined) => Promise<CursorPage<number>> {
  return vi.fn((cursor: string | undefined) => {
    const index = cursor === undefined ? 0 : Number(cursor);
    const items = Object.freeze([...(chunks[index] ?? [])]);
    const next = index + 1 < chunks.length ? String(index + 1) : null;
    return Promise.resolve(Object.freeze({ items, next_cursor: next }));
  });
}

describe("R4.12 fetchAllPages", () => {
  it("R4.12 one page with no cursor is read once", async () => {
    const fetchPage = pages([1, 2]);
    await expect(fetchAllPages(fetchPage, 3, "the list")).resolves.toEqual([1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(undefined);
  });

  it("R4.12 follows the cursor and concatenates frozen pages in order", async () => {
    const fetchPage = pages([1], [2, 3], [4]);
    await expect(fetchAllPages(fetchPage, 3, "the list")).resolves.toEqual([1, 2, 3, 4]);
    expect(vi.mocked(fetchPage).mock.calls.map(([cursor]) => cursor)).toEqual([undefined, "1", "2"]);
  });

  it("R4.12 a cursor that does not end within the budget fails with the list's name", async () => {
    await expect(fetchAllPages(pages([1], [2], [3]), 2, "the track list")).rejects.toThrow(new RangeError("the track list did not end within 2 pages"));
  });

  it("R4.12 a failed page rejects with its error", async () => {
    const failure = new Error("page failed");
    await expect(fetchAllPages(() => Promise.reject(failure), 2, "the list")).rejects.toBe(failure);
  });
});
