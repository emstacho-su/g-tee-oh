/**
 * The explanation validator (R3.20, O-308, A6 section 5, 05 section 10.2, ADR 0016): an answer
 * passes only when every hand name, card name and number in it comes from its grounding. Pure: a
 * text and a grounding bundle in, a verdict out.
 *
 * Mechanism, in order, each step blanking what it read so the next does not read it again:
 * 0. The text and the labels are NFKC-normalized (full-width digits and letters become ASCII) and
 *    the unicode minus becomes a hyphen (PR #29 review M7).
 * 1. Action labels and seat names are blanked (the 10 of "Raise to 10bb" is part of a name).
 * 2. Worded names are read and must name a grounded class or card (PR #29 review M7): "five of
 *    hearts", "pocket fives" and "pair of fives", nicknames such as "big slick", and two ranks with
 *    an optional suited or offsuit ("ace five suited", "ace-five"). The shown phrase is reported.
 * 3. Combos (5h5d), then hand classes (AKs, AKo, 77, and A5 or KT without the suit letter), then
 *    cards (Ah) are read; each must be in the grounding's names. A two-digit token is a class only
 *    as a pair (55); 52 is a number. "As" and "Ah" opening a sentence are English words, not cards.
 * 4. Spelled-out numbers are read and are never validated (PR #29 review M7): the cardinal words
 *    zero to twenty, the tens, hundred, thousand, million, billion and dozen, joined by hyphens,
 *    spaces or "and", with an optional "percent". Bet levels and hand categories are not numbers
 *    ("three-bet", "ten-high", "two pair", "three of a kind"); ordinals and "half" are not read.
 * 5. Every remaining number is read wherever it stands, after a letter or a dot too ("x7",
 *    "EV1.8bb", ".35"): an optional sign (only where no letter or digit precedes it), decimal
 *    digits of any script, optional decimals, an optional percent sign and an optional bb suffix.
 *    A thousands separator makes the number unsupported, and so does a digit outside ASCII after
 *    NFKC (an Arabic-Indic digit, say). A number passes when, for some grounding value g, |n - g|
 *    or |n - 100 g| is at most half a unit of its last shown digit (a shown percentage of a share).
 *    No small integer is exempt, which is why the Ask prompt forbids list numerals.
 */
import type { GroundingBundle } from "./grounding.js";

export interface AnswerCheck {
  ok: boolean;
  unsupportedNumbers: string[];
  unsupportedNames: string[];
}

type CheckedGrounding = Pick<GroundingBundle, "names" | "labels" | "numbers">;

const NORMAL_FORM = "NFKC";
const UNICODE_MINUS = /−/g;
const ASCII_MINUS = "-";
const BLANK = " ";
const COMBO = /(?<![A-Za-z0-9])(?:[2-9TJQKA][cdhs]){2}(?![A-Za-z0-9])/g;
const CLASS_CANDIDATE = /(?<![A-Za-z0-9.,+-])[2-9TJQKA]{2}[so]?(?![A-Za-z0-9%]|\.\d|,\d|\s?bb\b)/g;
const CARD = /(?<![A-Za-z0-9])[2-9TJQKA][cdhs](?![A-Za-z0-9])/g;
// PR #29 review M7: no lookbehind on the digits, any decimal digit, a leading-dot decimal.
const NUMBER = /(?:(?<![\p{L}\p{N}])[-+])?(?:\p{Nd}+(?:,\p{Nd}+)*(?:\.\p{Nd}+)?|\.\p{Nd}+)(?:\s?%)?(?:\s?bb\b)?/gu;
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

/** Rank words with their rank letters (PR #29 review M7). */
const RANK_WORDS: Readonly<Record<string, string>> = {
  two: "2",
  deuce: "2",
  three: "3",
  trey: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "T",
  jack: "J",
  queen: "Q",
  king: "K",
  ace: "A",
};
const RANK_ORDER = "23456789TJQKA";
const PLURAL_ES_ENDING = "x";
const PAIR_RANKS = 2;
const SUIT_WORDS: Readonly<Record<string, string>> = { clubs: "c", diamonds: "d", hearts: "h", spades: "s" };
const SUITEDNESS_WORDS: Readonly<Record<string, string>> = { suited: "s", offsuit: "o", "off-suit": "o" };
const NICKNAMES: Readonly<Record<string, string>> = {
  "big slick": "AK",
  "pocket rockets": "AA",
  rockets: "AA",
  cowboys: "KK",
  ladies: "QQ",
  hooks: "JJ",
  snowmen: "88",
  ducks: "22",
};
const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty",
  "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million", "billion", "dozen",
];
/** Words after a number word that make it a poker term, not a numeric claim (PR #29 review M7). */
const NOT_A_NUMBER_AFTER = "bet|high";
const POKER_CATEGORIES = /\b(?:one|two)\s+pairs?\b|\b(?:three|four)\s+of\s+a\s+kind\b/giu;
const WHITESPACE_RUN = /\s+/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pluralOf(word: string): string {
  return word.endsWith(PLURAL_ES_ENDING) ? `${word}es` : `${word}s`;
}

const PLURAL_RANK_WORDS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(RANK_WORDS).map(([word, rank]) => [pluralOf(word), rank]),
);

/** An alternation of words, longest first, any whitespace run standing for a phrase's space. */
function alternation(words: readonly string[]): string {
  return [...words]
    .sort((a, b) => b.length - a.length)
    .map((word) => escapeRegExp(word).replace(/ /g, "\\s+"))
    .join("|");
}

const RANK = alternation(Object.keys(RANK_WORDS));
const WORDED_CARD = new RegExp(`\\b(${RANK})\\s+of\\s+(${alternation(Object.keys(SUIT_WORDS))})\\b`, "giu");
const WORDED_PAIR = new RegExp(`\\b(?:pocket|pair\\s+of)\\s+(${alternation(Object.keys(PLURAL_RANK_WORDS))})\\b`, "giu");
const NICKNAME = new RegExp(`\\b(?:${alternation(Object.keys(NICKNAMES))})\\b`, "giu");
const WORDED_CLASS = new RegExp(
  `\\b(${RANK})(?:-|\\s+)(${RANK})(?:\\s+(${alternation(Object.keys(SUITEDNESS_WORDS))}))?\\b`,
  "giu",
);
const NUMBER_WORD = `(?:${alternation(NUMBER_WORDS)})\\b(?![-\\s](?:${NOT_A_NUMBER_AFTER})\\b)`;
const NUMBER_PHRASE = new RegExp(
  `\\b${NUMBER_WORD}(?:(?:-|\\s+(?:and\\s+)?)${NUMBER_WORD})*(?:\\s+(?:percent|per\\s+cent)\\b)?`,
  "giu",
);

function lookup(table: Readonly<Record<string, string>>, word: string): string {
  return table[word.toLowerCase().replace(WHITESPACE_RUN, BLANK)] ?? "";
}

function blankLabels(text: string, labels: readonly string[]): string {
  const longestFirst = labels
    .map((label) => label.normalize(NORMAL_FORM))
    .filter((label) => label.length > 0)
    .sort((a, b) => b.length - a.length);
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

/** A name as the answer shows it and the grounding name it stands for. */
interface NameRead {
  shown: string;
  name: string;
}

interface Reading {
  rest: string;
  found: NameRead[];
}

/** The grounding name a match stands for, or null to leave the match unread. */
type NameOf = (match: string, groups: readonly string[], offset: number) => string | null;

/** Reads every match of `pattern` that `nameOf` names, blanking each in the returned text. */
function readNames(text: string, pattern: RegExp, nameOf: NameOf): Reading {
  const found: NameRead[] = [];
  const rest = text.replace(pattern, (match: string, ...args: unknown[]) => {
    // A replacer gets the capture groups, then the match offset (the first number argument).
    const offsetAt = args.findIndex((arg) => typeof arg === "number");
    const groups = args.slice(0, offsetAt).map((group) => (typeof group === "string" ? group : ""));
    const offset = args[offsetAt];
    const name = nameOf(match, groups, typeof offset === "number" ? offset : 0);
    if (name === null) {
      return match;
    }
    found.push({ shown: match, name });
    return BLANK.repeat(match.length);
  });
  return { rest, found };
}

type Reader = (text: string) => Reading;

/** Chains readers, each reading the text the previous one left. */
function readInTurn(text: string, readers: readonly Reader[]): Reading {
  return readers.reduce<Reading>(
    (reading, reader) => {
      const next = reader(reading.rest);
      return { rest: next.rest, found: [...reading.found, ...next.found] };
    },
    { rest: text, found: [] },
  );
}

/** A class from two rank letters, higher first, with the suit letter only for unpaired ranks. */
function classOf(oneRank: string, otherRank: string, suitedness: string): string {
  if (oneRank === otherRank) {
    return oneRank.repeat(PAIR_RANKS);
  }
  const [high = "", low = ""] = [oneRank, otherRank].sort((a, b) => RANK_ORDER.indexOf(b) - RANK_ORDER.indexOf(a));
  return `${high}${low}${suitedness}`;
}

/** Worded hand and card names (PR #29 review M7). */
const WORDED_READERS: readonly Reader[] = [
  (text) => readNames(text, WORDED_CARD, (_, [rank = "", suit = ""]) => lookup(RANK_WORDS, rank) + lookup(SUIT_WORDS, suit)),
  (text) => readNames(text, WORDED_PAIR, (_, [plural = ""]) => lookup(PLURAL_RANK_WORDS, plural).repeat(PAIR_RANKS)),
  (text) => readNames(text, NICKNAME, (match) => lookup(NICKNAMES, match)),
  (text) =>
    readNames(text, WORDED_CLASS, (_, [one = "", other = "", suitedness = ""]) =>
      classOf(lookup(RANK_WORDS, one), lookup(RANK_WORDS, other), lookup(SUITEDNESS_WORDS, suitedness)),
    ),
];

const NAME_READERS: readonly Reader[] = [
  ...WORDED_READERS,
  (text) => readNames(text, COMBO, (match) => match),
  (text) => readNames(text, CLASS_CANDIDATE, (match) => (isHandClass(match) ? match : null)),
  (text) => readNames(text, CARD, (match, _, offset) => (isWordNotCard(text, match, offset) ? null : match)),
];

/** Spelled-out numbers, none of which the validator can check against the grounding (PR #29 review M7). */
function readNumberWords(text: string): Reading {
  const withoutCategories = text.replace(POKER_CATEGORIES, (match) => BLANK.repeat(match.length));
  return readNames(withoutCategories, NUMBER_PHRASE, (match) => match);
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
  // Number() reads only ASCII digits, so a digit of another script is NaN and never passes (M7).
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
  const normalized = text.normalize(NORMAL_FORM).replace(UNICODE_MINUS, ASCII_MINUS);
  const names = readInTurn(blankLabels(normalized, grounding.labels), NAME_READERS);
  const unsupportedNames = unique(names.found.filter(({ name }) => !grounding.names.has(name)).map(({ shown }) => shown));
  const words = readNumberWords(names.rest);
  const numbers = words.rest.match(NUMBER) ?? [];
  const unsupportedNumbers = unique([
    ...words.found.map(({ shown }) => shown),
    ...numbers.filter((token) => !numberSupported(token, grounding.numbers)),
  ]);
  return { ok: unsupportedNames.length === 0 && unsupportedNumbers.length === 0, unsupportedNumbers, unsupportedNames };
}
