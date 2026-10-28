/**
 * The table seats of a trainer prompt (S25, R3.13, A7 section 3). Pure.
 *
 * Mechanism: the prompt's stacks_cbb lists one stack per seat in gto-model's seated order for the
 * table size (Position::seated, pinned in services/api/src/catalog/seats.ts, O-234), so the stack
 * count names the table size and the order names each seat's position. This is naming data, not
 * poker math (ADR 0004): stacks are shown as the api sent them, and no bet is derived. The hero's
 * seat carries the hole cards, the BTN seat the dealer button, and a seat whose last entry in the
 * history is a fold is marked folded. A stack count with no seat list gives no seats, so PokerTable
 * renders its own alert rather than a guessed table.
 */
import type { TableSeat } from "../components/table/index.js";
import type { Position, TrainerPrompt } from "../contracts.js";

/** Position::seated by table size, the same lists as the api's catalog/seats.ts. */
const SEATED: Readonly<Record<number, readonly Position[]>> = {
  2: ["BTN", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["CO", "BTN", "SB", "BB"],
  5: ["HJ", "CO", "BTN", "SB", "BB"],
  6: ["UTG", "HJ", "CO", "BTN", "SB", "BB"],
  7: ["UTG", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  8: ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  9: ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
};

const BUTTON: Position = "BTN";
const FOLD_TOKEN = "f";

function foldedPositions(prompt: TrainerPrompt): ReadonlySet<Position> {
  const lastToken = new Map<Position, string>();
  for (const entry of prompt.history) lastToken.set(entry.position, entry.token);
  return new Set([...lastToken].filter(([, token]) => token === FOLD_TOKEN).map(([position]) => position));
}

export function seatsOfPrompt(prompt: TrainerPrompt): TableSeat[] {
  const positions = SEATED[prompt.stacks_cbb.length];
  if (positions === undefined) return [];
  const folded = foldedPositions(prompt);
  const [first, second] = prompt.hero_hand;
  return positions.map((position, seat) => {
    const isHero = position === prompt.hero_position;
    return {
      position,
      stackCbb: prompt.stacks_cbb[seat] ?? 0,
      isHero,
      hasFolded: folded.has(position),
      isButton: position === BUTTON,
      isStraddle: false,
      ...(isHero && first !== undefined && second !== undefined ? { cards: [first, second] as const } : {}),
    };
  });
}
