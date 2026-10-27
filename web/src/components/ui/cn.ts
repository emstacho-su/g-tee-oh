/** Joins class names, skipping false, null, undefined and empty strings. */
export function cn(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(" ");
}
