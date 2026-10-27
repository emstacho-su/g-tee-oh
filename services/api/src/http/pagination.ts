/**
 * Cursor pagination schemas (R3.1, A5 section 3). Every collection GET takes cursor and limit
 * and answers {items, next_cursor}; next_cursor is null on the last page. The cursor is opaque
 * to clients: base64url text the server alone encodes and decodes (cursor.ts), so the sort key
 * can change without a contract change.
 */
import { z } from "zod";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;
export const MAX_CURSOR_LENGTH = 512;

export const pageQuerySchema = z.object({
  cursor: z
    .string()
    .min(1)
    .max(MAX_CURSOR_LENGTH)
    .optional()
    .describe("The next_cursor of the previous page; absent for the first page"),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_LIMIT)
    .default(DEFAULT_PAGE_LIMIT)
    .describe(`Page size, 1 to ${MAX_PAGE_LIMIT}`),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    next_cursor: z.string().nullable().describe("Pass as cursor for the next page; null on the last page"),
  });
}

export interface Page<Item> {
  items: Item[];
  next_cursor: string | null;
}
