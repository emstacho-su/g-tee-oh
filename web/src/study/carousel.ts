/**
 * The position carousel's items (S39, R3.12, O-354, O-393, O-394): the table's seats in action
 * order, each in one state, for the URL's line in one pair's solution.
 *
 * Mechanism: lineDecisions turns the node at every prefix of the line (root first) into one
 * decision each: the seat is that node's to_act and the action taken is the line's next token,
 * labeled with the node's own exact-size label. The web never decides who acts next. carouselItems
 * then walks the seats in preflop action order once: a seat outside the pair folds (the pair
 * solution assumes it, O-394); a pair seat takes its next decision, either acted (with the action
 * it took) or current (the seat to act at the line's node); a pair seat whose turn has not come
 * waits. Every decision left after that first orbit (a reraise, a call of a reraise) is appended
 * as its own item. Pure functions; nothing here reads a node.
 */
import type { NodeAction, StudyNode } from "../contracts.js";
import type { Position } from "../drills/types.js";
import { exactActionLabel } from "../poker/format.js";
import { lineTokens, linePrefixes } from "./line.js";

export type CarouselState = "folded" | "acted" | "current" | "waiting";

export interface LineDecision {
  readonly seat: Position;
  /** The line of the node where the seat decides; "" is the root. */
  readonly line: string;
  /** The label of the action the line took there; undefined at the line's own node. */
  readonly taken: string | undefined;
}

export interface CarouselItem {
  readonly key: string;
  readonly seat: Position;
  readonly state: CarouselState;
  /** "Folds", the action taken, "To act" or "Waiting". */
  readonly text: string;
  /** The decision's line, for acted and current items. */
  readonly line?: string;
  /** Why a folded or waiting item cannot be chosen. */
  readonly reason?: string;
}

export const CAROUSEL_TEXT = {
  folded: "Folds",
  current: "To act",
  waiting: "Waiting",
  foldedReason: "Outside this pair's solution",
} as const;

export function waitingReason(currentSeat: Position): string {
  return `Acts after ${currentSeat}`;
}

type LineNode = Pick<StudyNode, "to_act" | "actions">;

function takenLabel(actions: readonly NodeAction[], token: string): string {
  const action = actions.find((candidate) => candidate.token === token);
  return action === undefined ? token : exactActionLabel(action);
}

/** One decision per prefix node; nodes[i] is the node at the line's i-th prefix (root first). */
export function lineDecisions(nodes: readonly LineNode[], line: string | undefined): LineDecision[] {
  const tokens = lineTokens(line);
  const prefixes = linePrefixes(line);
  return nodes.map((node, index) => {
    const token = tokens[index];
    return {
      seat: node.to_act,
      line: prefixes[index] ?? "",
      taken: token === undefined ? undefined : takenLabel(node.actions, token),
    };
  });
}

function decisionItem(decision: LineDecision, index: number): CarouselItem {
  const acted = decision.taken !== undefined;
  return {
    key: `${decision.seat}-${index}`,
    seat: decision.seat,
    state: acted ? "acted" : "current",
    text: decision.taken ?? CAROUSEL_TEXT.current,
    line: decision.line,
  };
}

export interface CarouselPair {
  readonly oop: string;
  readonly ip: string;
}

/** The seat items for a line in one pair's solution, in action order. */
export function carouselItems(
  seats: readonly Position[],
  pair: CarouselPair,
  decisions: readonly LineDecision[],
): CarouselItem[] {
  const inPair = (seat: Position) => seat === pair.oop || seat === pair.ip;
  const currentSeat = decisions.at(-1)?.seat;
  const firstOrbit: CarouselItem[] = [];
  let next = 0;
  seats.forEach((seat, index) => {
    if (!inPair(seat)) {
      firstOrbit.push({ key: `${seat}-fold`, seat, state: "folded", text: CAROUSEL_TEXT.folded, reason: CAROUSEL_TEXT.foldedReason });
      return;
    }
    const decision = decisions[next];
    if (decision !== undefined && decision.seat === seat) {
      firstOrbit.push(decisionItem(decision, next));
      next += 1;
      return;
    }
    firstOrbit.push({
      key: `${seat}-wait-${index}`,
      seat,
      state: "waiting",
      text: CAROUSEL_TEXT.waiting,
      ...(currentSeat === undefined ? {} : { reason: waitingReason(currentSeat) }),
    });
  });
  const later = decisions.slice(next).map((decision, offset) => decisionItem(decision, next + offset));
  return [...firstOrbit, ...later];
}
