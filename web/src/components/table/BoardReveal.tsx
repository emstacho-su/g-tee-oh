/**
 * The board, revealed street by street (S24, A7, R3.13). Three labeled groups hold the flop's
 * three slots and the turn's and river's one each; an undealt slot is a dashed outline named
 * "Turn not dealt". A board has 0, 3, 4 or 5 cards; any other count renders an alert.
 *
 * Mechanism: the component remembers the board it last showed. When the new board extends it
 * (same leading cards, more of them), the added cards are new: they get a short fade and slide
 * in through the CSS starting style, skipped under prefers-reduced-motion, and a polite live
 * region announces them ("Turn: Two of spades"; "Board: ..." when more than one street lands at
 * once). The first render, or a board that does not extend the last one (a new hand), shows its
 * cards as they are, with no animation and no announcement.
 */
import { useState } from "react";

import { cn } from "../ui/index.js";
import { cardName, parseCard } from "../../poker/cards.js";
import { CardView } from "./CardView.js";
import { usePrefersReducedMotion } from "./reduced-motion.js";

export const BOARD_SIZES: readonly number[] = [0, 3, 4, 5];

export type RevealMode = "shown" | "animate" | "instant";

export interface BoardRevealProps {
  cards: readonly string[];
  fourColor?: boolean;
}

interface Street {
  readonly name: string;
  readonly from: number;
  readonly to: number;
}

const STREETS: readonly Street[] = [
  { name: "Flop", from: 0, to: 3 },
  { name: "Turn", from: 3, to: 4 },
  { name: "River", from: 4, to: 5 },
];

interface RevealState {
  readonly key: string;
  readonly cards: readonly string[];
  /** Index of the first card added by the last change; equal to cards.length when none. */
  readonly newFrom: number;
}

function extendsBoard(previous: readonly string[], next: readonly string[]): boolean {
  return next.length > previous.length && previous.every((card, index) => next[index] === card);
}

/** Derives which cards are new, updating the remembered board during render (React's derived-state pattern). */
function useRevealState(cards: readonly string[]): RevealState {
  const key = cards.join(",");
  const [state, setState] = useState<RevealState>({ key, cards, newFrom: cards.length });
  if (state.key === key) return state;
  const next: RevealState = { key, cards, newFrom: extendsBoard(state.cards, cards) ? state.cards.length : cards.length };
  setState(next);
  return next;
}

function spokenName(card: string): string {
  try {
    return cardName(parseCard(card));
  } catch {
    return `invalid card ${JSON.stringify(card)}`;
  }
}

export function announcement(cards: readonly string[], newFrom: number): string {
  if (newFrom >= cards.length) return "";
  const street = STREETS.find((candidate) => candidate.from === newFrom && candidate.to === cards.length);
  const names = cards.slice(newFrom).map(spokenName).join(", ");
  return `${street?.name ?? "Board"}: ${names}`;
}

function revealMode(index: number, newFrom: number, reduceMotion: boolean): RevealMode {
  if (index < newFrom) return "shown";
  return reduceMotion ? "instant" : "animate";
}

const ANIMATE_CLASSES = "transition-[opacity,translate] duration-300 ease-out starting:-translate-y-2 starting:opacity-0";

export function BoardReveal({ cards, fourColor = false }: BoardRevealProps) {
  const state = useRevealState(cards);
  const reduceMotion = usePrefersReducedMotion();
  if (!BOARD_SIZES.includes(cards.length)) {
    return (
      <p role="alert" data-testid="board-reveal" className="rounded border border-danger p-2 text-danger">
        {`A board holds 0, 3, 4 or 5 cards; got ${cards.length}.`}
      </p>
    );
  }
  return (
    <div data-testid="board-reveal" className="flex items-center gap-3">
      {STREETS.map((street) => (
        <div key={street.name} role="group" aria-label={street.name} className="flex gap-1">
          {Array.from({ length: street.to - street.from }, (_, offset) => {
            const index = street.from + offset;
            const card = cards[index];
            if (card === undefined) {
              return (
                <span
                  key={index}
                  role="img"
                  aria-label={`${street.name} not dealt`}
                  className="inline-block h-12 w-9 rounded-md border-2 border-dashed border-white/40"
                />
              );
            }
            const mode = revealMode(index, state.newFrom, reduceMotion);
            return (
              <span key={`${index}-${card}`} data-testid={`board-card-${index}`} data-reveal={mode} className={cn("inline-flex", mode === "animate" && ANIMATE_CLASSES)}>
                <CardView card={card} fourColor={fourColor} />
              </span>
            );
          })}
        </div>
      ))}
      <p data-testid="board-announcement" aria-live="polite" className="sr-only">
        {announcement(cards, state.newFrom)}
      </p>
    </div>
  );
}
