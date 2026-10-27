/**
 * One playing card (S24, R3.13). The face prints the rank and the suit symbol, and the card's
 * accessible name is the spoken form from cardName ("Ace of hearts"), so the suit never depends
 * on color: the symbol and the name carry it. Two-color decks paint hearts and diamonds red; the
 * optional four-color deck paints diamonds blue and clubs green so the four suits differ at a
 * glance. A face-down card is named "Face-down card". A string that is not a card renders a named
 * error card rather than crashing the table (parseCard throws a RangeError on it).
 */
import { cn } from "../ui/index.js";
import { cardName, parseCard, rankLabel, suitSymbol, type Card, type Suit } from "../../poker/cards.js";

export type CardSize = "sm" | "md" | "lg";
export type SuitColor = "black" | "red" | "blue" | "green";

export interface CardViewProps {
  /** Two characters, rank then suit, for example "Ah". Missing means face down. */
  card?: string;
  faceDown?: boolean;
  size?: CardSize;
  fourColor?: boolean;
  className?: string;
}

const SIZE_CLASSES: Readonly<Record<CardSize, string>> = {
  sm: "h-9 w-7 text-sm",
  md: "h-12 w-9 text-base",
  lg: "h-16 w-12 text-xl",
};

const TWO_COLOR: Readonly<Record<Suit, SuitColor>> = { s: "black", h: "red", d: "red", c: "black" };
const FOUR_COLOR: Readonly<Record<Suit, SuitColor>> = { s: "black", h: "red", d: "blue", c: "green" };

const COLOR_CLASSES: Readonly<Record<SuitColor, string>> = {
  black: "text-slate-900",
  red: "text-red-600",
  blue: "text-blue-700",
  green: "text-green-700",
};

const BASE_CLASSES = "inline-flex shrink-0 select-none items-center justify-center rounded-md border font-semibold shadow-sm";
const FACE_DOWN_NAME = "Face-down card";

function tryParse(text: string): Card | null {
  try {
    return parseCard(text);
  } catch (error: unknown) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export function CardView({ card, faceDown = false, size = "md", fourColor = false, className }: CardViewProps) {
  const sizeClass = SIZE_CLASSES[size];
  if (faceDown || card === undefined) {
    return (
      <span
        role="img"
        aria-label={FACE_DOWN_NAME}
        data-testid="card-view"
        data-face="down"
        className={cn(BASE_CLASSES, sizeClass, "border-blue-900 bg-blue-800 bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.15)_0_3px,transparent_3px_6px)]", className)}
      />
    );
  }
  const parsed = tryParse(card);
  if (parsed === null) {
    return (
      <span
        role="img"
        aria-label={`Invalid card ${JSON.stringify(card)}`}
        data-testid="card-view"
        data-face="invalid"
        className={cn(BASE_CLASSES, sizeClass, "border-danger bg-white text-danger", className)}
      >
        <span aria-hidden="true">?</span>
      </span>
    );
  }
  const color = (fourColor ? FOUR_COLOR : TWO_COLOR)[parsed.suit];
  return (
    <span
      role="img"
      aria-label={cardName(parsed)}
      data-testid="card-view"
      data-face="up"
      data-card={card}
      data-suit-color={color}
      className={cn(BASE_CLASSES, sizeClass, "border-slate-300 bg-white", COLOR_CLASSES[color], className)}
    >
      <span aria-hidden="true">
        {rankLabel(parsed.rank)}
        {suitSymbol(parsed.suit)}
      </span>
    </span>
  );
}
