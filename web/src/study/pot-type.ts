/**
 * The pot type of a walked preflop line (S45, R3.12, screen critic, design rule 4: players think in
 * pot types). Pure.
 *
 * Mechanism: the label comes from the line's action tokens alone (line.ts), never from a size or
 * any number, so it is naming, not poker arithmetic, and it stays in the web (ADR 0004). A raise is
 * an r or a (all-in) token. No raise with a limp (l) or a call (c) is a limped pot; one raise a
 * single-raised pot; two a three-bet pot, or a squeeze pot when a call came between the first raise
 * and the second; three a four-bet pot; more an N-bet pot. The root, and a line of folds only, has no
 * pot type yet.
 */
import { lineTokens } from "./line.js";

const RAISE_LETTERS: ReadonlySet<string> = new Set(["r", "a"]);
const LIMP_LETTERS: ReadonlySet<string> = new Set(["l", "c"]);
const CALL_LETTER = "c";
/** A two-raise pot is a three-bet pot: the open is the second bet after the big blind. */
const BETS_PER_RAISE_OFFSET = 1;

const NAMED: Readonly<Record<number, string>> = {
  1: "single-raised pot",
  2: "three-bet pot",
  3: "four-bet pot",
};

function letterOf(token: string): string {
  return token.charAt(0);
}

/** True when a call sits between the first raise and the second (a squeeze). */
function squeezed(letters: readonly string[]): boolean {
  const raises = letters.flatMap((letter, index) => (RAISE_LETTERS.has(letter) ? [index] : []));
  const [first, second] = raises;
  if (first === undefined || second === undefined) return false;
  return letters.slice(first + 1, second).includes(CALL_LETTER);
}

/** "three-bet pot", "squeeze pot", "limped pot" and so on; undefined at the root or with folds only. */
export function potTypeLabel(line: string | undefined): string | undefined {
  const letters = lineTokens(line).map(letterOf);
  const raises = letters.filter((letter) => RAISE_LETTERS.has(letter)).length;
  if (raises === 0) return letters.some((letter) => LIMP_LETTERS.has(letter)) ? "limped pot" : undefined;
  if (raises === 2 && squeezed(letters)) return "squeeze pot";
  return NAMED[raises] ?? `${raises + BETS_PER_RAISE_OFFSET}-bet pot`;
}
