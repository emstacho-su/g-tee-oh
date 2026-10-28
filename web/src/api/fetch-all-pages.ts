/**
 * Every item of a cursor-paged api list (S32, R4.12): the tracks read and the configuration list.
 *
 * Mechanism: fetchPage is called with no cursor, then with each page's next_cursor until one is
 * null. Each page's items are appended to a new array, so no page is changed. Past maxPages the
 * read fails loudly with the list's name rather than show a silently cut list.
 */

/** One page of a cursor-paged api list. */
export interface CursorPage<Item> {
  readonly items: readonly Item[];
  readonly next_cursor: string | null;
}

export async function fetchAllPages<Item>(
  fetchPage: (cursor: string | undefined) => Promise<CursorPage<Item>>,
  maxPages: number,
  listName: string,
): Promise<Item[]> {
  const collect = async (cursor: string | undefined, pagesRead: number, collected: readonly Item[]): Promise<Item[]> => {
    if (pagesRead === maxPages) throw new RangeError(`${listName} did not end within ${maxPages} pages`);
    const page = await fetchPage(cursor);
    const items = [...collected, ...page.items];
    return page.next_cursor === null ? items : collect(page.next_cursor, pagesRead + 1, items);
  };
  return collect(undefined, 0, []);
}
