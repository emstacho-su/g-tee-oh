/**
 * The R3.19 number-membership check, written independently of the validator (O-308, O-309): blank
 * every name and label the grounding lists, read every number with one simple pattern, and keep
 * the ones that are neither a grounding value nor 100 times one at the precision shown. The
 * template tests require this and the validator to agree, so the test does not only trust the
 * validator.
 */
import type { GroundingBundle } from "../../src/explain/grounding.js";

const SIMPLE_NUMBER = /-?\d+(?:\.\d+)?/g;
const HALF = 0.5;
const EPSILON = 1e-9;
const PERCENT_SCALE = 100;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withoutNames(text: string, bundle: GroundingBundle): string {
  const strings = [...bundle.names, ...bundle.labels].sort((a, b) => b.length - a.length);
  // A name never touches a decimal point, so the pair 77 is not read inside 77.2%.
  return strings.reduce(
    (rest, name) => rest.replace(new RegExp(`(?<![\\w.])${escapeRegExp(name)}(?!\\w|\\.\\d)`, "g"), " "),
    text,
  );
}

function decimalsOf(token: string): number {
  return token.includes(".") ? (token.split(".")[1] ?? "").length : 0;
}

function supported(token: string, numbers: readonly number[]): boolean {
  const value = Number(token);
  const tolerance = HALF * 10 ** -decimalsOf(token) + EPSILON;
  return numbers.some((g) => Math.abs(value - g) <= tolerance || Math.abs(value - PERCENT_SCALE * g) <= tolerance);
}

/** The numbers of `text` that the grounding does not hold, by the simple extraction. */
export function unsupportedBySimpleExtraction(text: string, bundle: GroundingBundle): string[] {
  const tokens = withoutNames(text, bundle).match(SIMPLE_NUMBER) ?? [];
  return tokens.filter((token) => !supported(token, bundle.numbers));
}
