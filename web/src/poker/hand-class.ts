/**
 * Names the hero's hand as one of the 169 preflop hand classes (S25, R3.13, O-281). Pure.
 *
 * DecisionFeedback.hand may arrive as a class ("AJo", "77") or as two cards ("AhJd"). The range
 * view needs the class to select a matrix cell. This is naming, not poker math (ADR 0004): the
 * higher rank comes first, two cards of one rank are a pair, and two cards of one suit are
 * suited ("s"), otherwise offsuit ("o"), which is the class name hands.ts lays out on the grid.
 * Anything that is neither a known class nor two distinct valid cards returns null, so the
 * caller shows the range without a selection instead of guessing a cell.
 */
import { RANKS, parseCard, type Card } from "./cards.js";
import { cellOf } from "./hands.js";

const CARD_TEXT_LENGTH = 2;
const TWO_CARDS_LENGTH = CARD_TEXT_LENGTH * 2;

function cardOrNull(text: string): Card | null {
  try {
    return parseCard(text);
  } catch (error: unknown) {
    // parseCard signals malformed text with a RangeError; anything else is a bug.
    if (error instanceof RangeError) return null;
    throw error;
  }
}

function classOfCards(first: Card, second: Card): string | null {
  if (first.rank === second.rank && first.suit === second.suit) return null;
  const [high, low] = RANKS.indexOf(first.rank) <= RANKS.indexOf(second.rank) ? [first, second] : [second, first];
  if (high.rank === low.rank) return `${high.rank}${low.rank}`;
  return `${high.rank}${low.rank}${high.suit === low.suit ? "s" : "o"}`;
}

/** The hand class of a class name or two cards, or null when the text is neither. */
export function heroHandClass(hand: string): string | null {
  if (cellOf(hand) !== undefined) return hand;
  if (hand.length !== TWO_CARDS_LENGTH) return null;
  const first = cardOrNull(hand.slice(0, CARD_TEXT_LENGTH));
  const second = cardOrNull(hand.slice(CARD_TEXT_LENGTH));
  if (first === null || second === null) return null;
  return classOfCards(first, second);
}
