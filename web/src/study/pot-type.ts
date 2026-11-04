/**
 * The pot type of a walked preflop line (S45, R3.12, screen critic, design rule 4: players think in
 * pot types). Pure.
 *
 * Mechanism: the label comes from the line's action tokens alone (line.ts), never from a size or
 * any number, so it is naming, not poker arithmetic, and it stays in the web (ADR 0004). Only the
 * preflop part of the line counts (code review 2): preflopLine keeps the tokens taken at preflop
 * nodes, from the line's own node reads, never from a rule about when a street closes. A raise is an
 * r token. An all-in (a) is never counted as a raise, because without the amounts the web cannot
 * tell an all-in for less from a raise; a line holding one is an all-in pot. No raise with a limp
 * (l) or a call (c) is a limped pot; one raise a single-raised pot; two a three-bet pot, or a
 * squeeze pot when a call came between the first raise and the second; three a four-bet pot; more an
 * N-bet pot. The root, and a line of folds only, has no pot type yet.
 */
import type { Street } from "../contracts.js";
import { LINE_SEPARATOR, lineTokens } from "./line.js";

const RAISE_LETTER = "r";
const ALL_IN_LETTER = "a";
const LIMP_LETTERS: ReadonlySet<string> = new Set(["l", "c"]);
const CALL_LETTER = "c";
/** A two-raise pot is a three-bet pot: the open is the second bet after the big blind. */
const BETS_PER_RAISE_OFFSET = 1;
const PREFLOP: Street = "preflop";

const NAMED: Readonly<Record<number, string>> = {
  1: "single-raised pot",
  2: "three-bet pot",
  3: "four-bet pot",
};

export const ALL_IN_POT = "all-in pot";

function letterOf(token: string): string {
  return token.charAt(0);
}

/** True when a call sits between the first raise and the second (a squeeze). */
function squeezed(letters: readonly string[]): boolean {
  const raises = letters.flatMap((letter, index) => (letter === RAISE_LETTER ? [index] : []));
  const [first, second] = raises;
  if (first === undefined || second === undefined) return false;
  return letters.slice(first + 1, second).includes(CALL_LETTER);
}

/**
 * The line's tokens taken at preflop nodes: token i is taken at the node of the line's first i
 * tokens, so it counts while that node is preflop and the rest stop at the first later street.
 * `prefixNodes` are those nodes in order (the carousel's line reads); undefined line, undefined.
 */
export function preflopLine(line: string | undefined, prefixNodes: readonly { readonly street: Street }[]): string | undefined {
  if (line === undefined) return undefined;
  const tokens = lineTokens(line);
  const end = tokens.findIndex((_, index) => prefixNodes[index]?.street !== PREFLOP);
  return (end < 0 ? tokens : tokens.slice(0, end)).join(LINE_SEPARATOR);
}

/** "three-bet pot", "squeeze pot", "all-in pot", "limped pot" and so on; undefined at the root or with folds only. */
export function potTypeLabel(line: string | undefined): string | undefined {
  const letters = lineTokens(line).map(letterOf);
  if (letters.includes(ALL_IN_LETTER)) return ALL_IN_POT;
  const raises = letters.filter((letter) => letter === RAISE_LETTER).length;
  if (raises === 0) return letters.some((letter) => LIMP_LETTERS.has(letter)) ? "limped pot" : undefined;
  if (raises === 2 && squeezed(letters)) return "squeeze pot";
  return NAMED[raises] ?? `${raises + BETS_PER_RAISE_OFFSET}-bet pot`;
}
