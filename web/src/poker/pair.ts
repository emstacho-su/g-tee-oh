/**
 * The one split of a position pair the web uses (PR #48 review round 2 LOW 9, S45 code review 3,
 * PR 52 review 1). A pair names the out-of-position seat first ("BB-BTN": BB out of position, BTN in
 * position), as the contract and solver-query do (O-234). A pure string split: it reads the two
 * seats and never orders or checks them, so the web applies no poker rule of its own (ADR 0004);
 * study/settings.ts orders the seats by the table's action order for its panel. Anything that is
 * not two non-empty parts joined by one dash reads as none.
 */
const PAIR_SEPARATOR = "-";
const PAIR_SEATS = 2;

/** The pair's seats, out of position first, or null when it is not two non-empty parts. */
export function parsePair(pair: string | undefined): readonly [oop: string, ip: string] | null {
  const seats = (pair ?? "").split(PAIR_SEPARATOR);
  const [first, second] = seats;
  if (seats.length !== PAIR_SEATS || first === undefined || second === undefined || first === "" || second === "") return null;
  return [first, second];
}
