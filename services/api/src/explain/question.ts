/**
 * The Ask question at the boundary (R3.20, O-307, PM3): after the body schema has trimmed it and
 * capped it at 500 characters, every control character becomes a space and every invisible format
 * character (zero-width and bidirectional marks) is removed, then runs of whitespace collapse to
 * one space (http/free-text.ts, the rule S41's quiz reason shares). The cleaned text is what the
 * model's user turn carries; the cache key hashes its lowercase form (PM1), so a question differing
 * only in case or spacing hits the same entry.
 */
import { cleanFreeText } from "../http/free-text.js";

/** The question with control and format characters gone and whitespace collapsed; "" when nothing is left. */
export function cleanQuestion(question: string): string {
  return cleanFreeText(question);
}

/** The form the cache key hashes: the cleaned question in lowercase (PM1). */
export function normalizeQuestion(question: string): string {
  return cleanQuestion(question).toLowerCase();
}
