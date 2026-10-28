/**
 * The explanation validator (R3.20, O-308, A6 section 5, 05 section 10.2, ADR 0016): an answer
 * passes only when every hand name, card name and number in it comes from its grounding. Pure: a
 * text and a grounding bundle in, a verdict out.
 *
 * Mechanism, in order, each step blanking what it read so the next does not read it again:
 * 1. Action labels and seat names are blanked (the 10 of "Raise to 10bb" is part of a name).
 * 2. Combos (5h5d), then hand classes (AKs, AKo, 77, and A5 or KT without the suit letter), then
 *    cards (Ah) are read; each must be in the grounding's names. A two-digit token is a class only
 *    as a pair (55); 52 is a number. "As" and "Ah" opening a sentence are English words, not cards.
 * 3. Every remaining number is read: an optional sign (the unicode minus too), digits, optional
 *    decimals, an optional percent sign and an optional bb suffix. A thousands separator makes the
 *    number unsupported. A number passes when, for some grounding value g, |n - g| or |n - 100 g|
 *    is at most half a unit of its last shown digit (a shown percentage of a share). No small
 *    integer is exempt, which is why the Ask prompt forbids list numerals.
 */
import type { GroundingBundle } from "./grounding.js";

export interface AnswerCheck {
  ok: boolean;
  unsupportedNumbers: string[];
  unsupportedNames: string[];
}

type CheckedGrounding = Pick<GroundingBundle, "names" | "labels" | "numbers">;

const UNICODE_MINUS = /−/g;
const ASCII_MINUS = "-";
const BLANK = " ";
const COMBO = /(?<![A-Za-z0-9])(?:[2-9TJQKA][cdhs]){2}(?![A-Za-z0-9])/g;
const CLASS_CANDIDATE = /(?<![A-Za-z0-9.,+-])[2-9TJQKA]{2}[so]?(?![A-Za-z0-9%]|\.\d|,\d|\s?bb\b)/g;
const CARD = /(?<![A-Za-z0-9])[2-9TJQKA][cdhs](?![A-Za-z0-9])/g;
const NUMBER = /(?<![\w.])[-+]?\d+(?:,\d+)*(?:\.\d+)?(?:\s?%)?(?:\s?bb\b)?/g;
const LETTER_RANK = /[TJQKA]/;
const SUIT_LETTERS = "so";
const WORD_LIKE_CARDS: ReadonlySet<string> = new Set(["As", "Ah"]);
const SENTENCE_START = /(?:^|[.!?:;]\s+|\n\s*)$/;
const THOUSANDS_SEPARATOR = ",";
const PERCENT_SUFFIX = /\s?%$/;
const BB_SUFFIX = /\s?bb$/;
const HALF_UNIT = 0.5;
const DECIMAL_BASE = 10;
const PERCENT_PER_SHARE = 100;
const FLOAT_SLACK = 1e-9;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blankLabels(text: string, labels: readonly string[]): string {
  const longestFirst = [...labels].filter((label) => label.length > 0).sort((a, b) => b.length - a.length);
  return longestFirst.reduce(
    (rest, label) => rest.replace(new RegExp(`(?<![\\w.])${escapeRegExp(label)}(?!\\w)`, "g"), BLANK),
    text,
  );
}

function isHandClass(token: string): boolean {
  const [first = "", second = "", suffix] = token;
  if (first === second) {
    return suffix === undefined;
  }
  return suffix !== undefined ? SUIT_LETTERS.includes(suffix) : LETTER_RANK.test(token);
}

function isWordNotCard(text: string, token: string, offset: number): boolean {
  return WORD_LIKE_CARDS.has(token) && SENTENCE_START.test(text.slice(0, offset));
}

interface Reading {
  rest: string;
  found: string[];
}

/** Reads every match of `pattern` that `accept` keeps, blanking each in the returned text. */
function readNames(text: string, pattern: RegExp, accept: (token: string, offset: number) => boolean): Reading {
  const found: string[] = [];
  const rest = text.replace(pattern, (token: string, offset: number) => {
    if (!accept(token, offset)) {
      return token;
    }
    found.push(token);
    return BLANK.repeat(token.length);
  });
  return { rest, found };
}

function readAllNames(text: string): Reading {
  const combos = readNames(text, COMBO, () => true);
  const classes = readNames(combos.rest, CLASS_CANDIDATE, isHandClass);
  const cards = readNames(classes.rest, CARD, (token, offset) => !isWordNotCard(classes.rest, token, offset));
  return { rest: cards.rest, found: [...combos.found, ...classes.found, ...cards.found] };
}

function decimalsShown(digits: string): number {
  const [, decimals = ""] = digits.split(".");
  return decimals.length;
}

/** True when the shown number rounds from a grounding value or from 100 times one. */
export function numberSupported(token: string, numbers: readonly number[]): boolean {
  if (token.includes(THOUSANDS_SEPARATOR)) {
    return false;
  }
  const digits = token.replace(BB_SUFFIX, "").replace(PERCENT_SUFFIX, "");
  const value = Number(digits);
  const tolerance = HALF_UNIT * DECIMAL_BASE ** -decimalsShown(digits) + FLOAT_SLACK;
  return numbers.some(
    (grounded) => Math.abs(value - grounded) <= tolerance || Math.abs(value - PERCENT_PER_SHARE * grounded) <= tolerance,
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Checks an answer against its grounding (O-308). */
export function validateAnswer(text: string, grounding: CheckedGrounding): AnswerCheck {
  const normalized = blankLabels(text.replace(UNICODE_MINUS, ASCII_MINUS), grounding.labels);
  const names = readAllNames(normalized);
  const unsupportedNames = unique(names.found.filter((name) => !grounding.names.has(name)));
  const numbers = names.rest.match(NUMBER) ?? [];
  const unsupportedNumbers = unique(numbers.filter((token) => !numberSupported(token, grounding.numbers)));
  return { ok: unsupportedNames.length === 0 && unsupportedNumbers.length === 0, unsupportedNumbers, unsupportedNames };
}
