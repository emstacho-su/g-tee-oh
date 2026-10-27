/**
 * Card parsing and naming for the web (S24). A card on the wire is two characters, rank then
 * suit ("Ah", "Td"), as the api contract's card pattern ^[2-9TJQKA][cdhs]$ fixes. This module
 * only names cards for display; it computes no poker math (ADR 0004).
 */
export const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
export const SUITS = ["s", "h", "d", "c"] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

const RANK_NAMES: Readonly<Record<Rank, string>> = {
  A: "Ace",
  K: "King",
  Q: "Queen",
  J: "Jack",
  T: "Ten",
  "9": "Nine",
  "8": "Eight",
  "7": "Seven",
  "6": "Six",
  "5": "Five",
  "4": "Four",
  "3": "Three",
  "2": "Two",
};

const SUIT_NAMES: Readonly<Record<Suit, string>> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
const SUIT_SYMBOLS: Readonly<Record<Suit, string>> = { s: "♠", h: "♥", d: "♦", c: "♣" };

function isRank(value: string): value is Rank {
  return (RANKS as readonly string[]).includes(value);
}

function isSuit(value: string): value is Suit {
  return (SUITS as readonly string[]).includes(value);
}

/** Parses "Ah" into a Card; throws a RangeError naming the input when it is not a card. */
export function parseCard(text: string): Card {
  const rank = text.charAt(0);
  const suit = text.charAt(1);
  if (text.length !== 2 || !isRank(rank) || !isSuit(suit)) {
    throw new RangeError(`not a card: ${JSON.stringify(text)}`);
  }
  return { rank, suit };
}

/** "Ace of hearts": the accessible name of a card. */
export function cardName(card: Card): string {
  return `${RANK_NAMES[card.rank]} of ${SUIT_NAMES[card.suit]}`;
}

export function suitSymbol(suit: Suit): string {
  return SUIT_SYMBOLS[suit];
}

/** "10" for T so the face reads naturally; other ranks print as they are. */
export function rankLabel(rank: Rank): string {
  return rank === "T" ? "10" : rank;
}
