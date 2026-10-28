/**
 * The drill's preflop action families as action-history vocabulary (R3.6, 05 section 4, ADR 0004,
 * O-249): which families a hero decision belongs to, read from the preflop tokens played before
 * the hero acts (the drill's line, then the hand's history). Nothing here is a poker number; it
 * counts tokens of the A3 section 1 grammar the way gto-model's ActionFamily::classify does
 * (raises are r, b and a; a limp is l; a straddle is s<cbb>; a call is c).
 *
 * A pair's preflop line is heads up, so its actions alternate between the two seats: the token
 * k places before the hero's turn was the hero's own when k is even. The families:
 * - rfi: no raise and no limp before the hero (the hero is first in);
 * - limp_iso: a limp and at most one raise (facing limps, or a limper facing the isolation raise);
 * - vs_open: exactly one raise, no limp, no call after it (the hero faces an open);
 * - squeeze: exactly one raise and a call after it, no limp;
 * - srp: exactly one raise, no limp (any decision in a single-raised pot);
 * - three_bet: exactly two raises, no limp (any decision in a 3-bet pot);
 * - vs_three_bet: exactly two raises, no limp, the first of them the hero's (the opener faces a 3-bet);
 * - four_bet: three raises or more, no limp (a 4-bet pot);
 * - straddle: a straddle in the line; a straddled line matches no other family.
 */
import { PREFLOP_ACTIONS } from "../schemas/drills.js";

export type PreflopAction = (typeof PREFLOP_ACTIONS)[number];

const LINE_SEPARATOR = ".";
const RAISE_LETTERS = ["r", "b"];
const ALL_IN_TOKEN = "a";
const LIMP_TOKEN = "l";
const CALL_TOKEN = "c";
const STRADDLE_LETTER = "s";
/** Raises in a single-raised pot, a 3-bet pot, and the fewest in a 4-bet pot. */
const SINGLE_RAISE = 1;
const THREE_BET_RAISES = 2;
const FOUR_BET_RAISES = 3;
/** Two seats alternate, so a token an even number of places back was the hero's. */
const SEATS_IN_A_PAIR = 2;

interface LineFacts {
  raises: number;
  limped: boolean;
  straddled: boolean;
  calledAfterRaise: boolean;
  heroRaisedFirst: boolean;
}

function isRaise(token: string): boolean {
  return token === ALL_IN_TOKEN || RAISE_LETTERS.some((letter) => token.startsWith(letter));
}

function lineFacts(tokens: readonly string[]): LineFacts {
  const firstRaise = tokens.findIndex(isRaise);
  return {
    raises: tokens.filter(isRaise).length,
    limped: tokens.includes(LIMP_TOKEN),
    straddled: tokens.some((token) => token.startsWith(STRADDLE_LETTER)),
    calledAfterRaise: firstRaise >= 0 && tokens.slice(firstRaise + 1).includes(CALL_TOKEN),
    heroRaisedFirst: firstRaise >= 0 && (tokens.length - firstRaise) % SEATS_IN_A_PAIR === 0,
  };
}

const RULES: Readonly<Record<PreflopAction, (facts: LineFacts) => boolean>> = {
  rfi: (facts) => facts.raises === 0 && !facts.limped,
  vs_open: (facts) => facts.raises === SINGLE_RAISE && !facts.limped && !facts.calledAfterRaise,
  srp: (facts) => facts.raises === SINGLE_RAISE && !facts.limped,
  three_bet: (facts) => facts.raises === THREE_BET_RAISES && !facts.limped,
  vs_three_bet: (facts) => facts.raises === THREE_BET_RAISES && !facts.limped && facts.heroRaisedFirst,
  four_bet: (facts) => facts.raises >= FOUR_BET_RAISES && !facts.limped,
  squeeze: (facts) => facts.raises === SINGLE_RAISE && !facts.limped && facts.calledAfterRaise,
  limp_iso: (facts) => facts.limped && facts.raises <= SINGLE_RAISE,
  straddle: () => true,
};

/** The families of a hero decision after `tokens`, in the PREFLOP_ACTIONS order. */
export function familiesOf(tokens: readonly string[]): PreflopAction[] {
  const facts = lineFacts(tokens);
  if (facts.straddled) {
    return ["straddle"];
  }
  return PREFLOP_ACTIONS.filter((family) => family !== "straddle" && RULES[family](facts));
}

/** True when the decision after `tokens` is in any of the drill's families. */
export function matchesFamilies(wanted: readonly PreflopAction[], tokens: readonly string[]): boolean {
  const families = familiesOf(tokens);
  return wanted.some((family) => families.includes(family));
}

/** The tokens of a dotted preflop line; none for the pair's root. */
export function lineTokens(line: string | null): string[] {
  return line === null || line === "" ? [] : line.split(LINE_SEPARATOR);
}
