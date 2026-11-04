/**
 * The one split of a position pair the web shares (S45 follow-up, R3.12, code review 3). A pair
 * names the out-of-position seat first ("BB-BTN": BB out of position, BTN in position), as the
 * contract and solver-query do. A pure string split: the address validator (study/search.ts) and the
 * contract already hold the pair to known positions, and nothing about who acts first preflop is
 * decided here (study/settings.ts orders the seats by the table's action order for its panel).
 * Anything that is not two non-empty parts joined by one dash reads as none.
 */
const PAIR_SEPARATOR = "-";
const PAIR_PARTS = 2;

export interface PairPositions {
  readonly oop: string;
  readonly ip: string;
}

export function pairPositions(pair: string | undefined): PairPositions | null {
  const parts = (pair ?? "").split(PAIR_SEPARATOR);
  const [oop, ip] = parts;
  if (parts.length !== PAIR_PARTS || oop === undefined || ip === undefined || oop === "" || ip === "") return null;
  return { oop, ip };
}
