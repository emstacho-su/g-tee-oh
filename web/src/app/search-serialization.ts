/**
 * How the router reads and writes the query string (S25, R3.12, R3.13, O-286, O-288).
 *
 * Mechanism: TanStack Router's default parseSearch decodes with its qss helper, which turns any
 * numeric-looking value into a number ("77" becomes 77, "1e00000000000000" becomes 1), and then
 * JSON-parses the rest. The route validators accept a hand or a seed only as a string (the shape
 * the api accepts), so ?hand=77 or a seed that looks numeric was silently dropped. These two
 * functions keep every value exactly the string in the URL: parseSearchAsStrings reads the query
 * with URLSearchParams (a repeated key keeps its last value), and stringifySearchAsStrings writes
 * strings as they are, numbers and booleans as their text and anything else as JSON. Numeric
 * filters (table size, depth) are converted by their own validators (src/study/search.ts), so a
 * link written from { table_size: 6 } reads back as 6.
 */

/** Every query value as the string in the URL; a repeated key keeps its last value. */
export function parseSearchAsStrings(searchStr: string): Record<string, string> {
  const query = searchStr.startsWith("?") ? searchStr.slice(1) : searchStr;
  // Object.fromEntries defines own properties, so a "__proto__" key never touches the prototype.
  return Object.fromEntries(new Map(new URLSearchParams(query)));
}

function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value);
}

/** The query string for a search object: "" when empty, else "?" and the encoded pairs. */
export function stringifySearchAsStrings(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined) params.set(key, valueText(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}
