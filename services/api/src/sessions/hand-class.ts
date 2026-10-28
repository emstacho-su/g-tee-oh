/**
 * Hand class names (R3.6, 05 section 4): the 169-class label of a two-card combo, and a written
 * class in canonical rank order, so a drill's manual hand list compares with the class labels
 * solver-query writes in the preflop_169 space (AKs, AKo, QQ, high rank first). This is naming
 * only; no poker number is computed (ADR 0004).
 */
import { CARD_PATTERN, HAND_CLASS_PATTERN } from "../schemas/common.js";

/** Ranks from high to low, the order a class names them in. */
const RANKS = "AKQJT98765432";
const CARD_LENGTH = 2;
const SUITED = "s";
const OFFSUIT = "o";

function rankOrder(rank: string): number {
  return RANKS.indexOf(rank);
}

function highFirst(first: string, second: string): string {
  return rankOrder(first) <= rankOrder(second) ? `${first}${second}` : `${second}${first}`;
}

/** The class of a combo such as AhKd (AKo), KhAh (AKs) or QsQc (QQ). */
export function comboClass(combo: string): string {
  const first = combo.slice(0, CARD_LENGTH);
  const second = combo.slice(CARD_LENGTH);
  if (!CARD_PATTERN.test(first) || !CARD_PATTERN.test(second)) {
    throw new RangeError(`${JSON.stringify(combo)} is not two cards`);
  }
  const [rankA, suitA] = first;
  const [rankB, suitB] = second;
  if (rankA === undefined || rankB === undefined) {
    throw new RangeError(`${JSON.stringify(combo)} is not two cards`);
  }
  if (rankA === rankB) {
    return `${rankA}${rankB}`;
  }
  return `${highFirst(rankA, rankB)}${suitA === suitB ? SUITED : OFFSUIT}`;
}

/** A written class with its ranks high first: KAs is AKs. */
export function canonicalClass(handClass: string): string {
  if (!HAND_CLASS_PATTERN.test(handClass)) {
    throw new RangeError(`${JSON.stringify(handClass)} is not a hand class`);
  }
  const [rankA = "", rankB = ""] = handClass;
  return `${highFirst(rankA, rankB)}${handClass.slice(CARD_LENGTH)}`;
}
