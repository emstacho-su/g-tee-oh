/**
 * The paint check of POST /range-paint/submit (R3.17, O-300, ADR 0004, ADR 0020): before anything
 * is graded, a paint must name every class the prompt lists exactly once, and nothing else, and
 * each painted index must be one of the node's tree actions.
 *
 * Mechanism: the body's paint is a JSON object, so a class can appear at most once; the check
 * counts the prompt's classes the paint lacks, the paint's classes the prompt does not list, and
 * the painted indexes that name no action, and answers one 400 validation problem with those three
 * counts. The detail never echoes a class or an index the caller sent (security rule: error
 * details never repeat user input). The checked paint is returned in the prompt's class order, the
 * order solver-query answers per_hand in, so the api sends it as solver-query would list it.
 * solver-query checks the same rules again (its grade-range 400), so this is the boundary check
 * that gives the caller a named reason, not the only one.
 */
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import type { SqPaintedHand } from "../sessions/solver-port.js";

/** The part of a prompt the paint is checked against: its classes and its brushes. */
export interface PaintTarget {
  hands: readonly string[];
  actions: readonly { index: number }[];
}

interface PaintFaults {
  missing: number;
  extra: number;
  notAnAction: number;
}

function faultsOf(target: PaintTarget, paint: Readonly<Record<string, number>>): PaintFaults {
  const held = new Set(target.hands);
  const indexes = new Set(target.actions.map((action) => action.index));
  const painted = Object.entries(paint);
  return {
    missing: target.hands.filter((hand) => !Object.hasOwn(paint, hand)).length,
    extra: painted.filter(([hand]) => !held.has(hand)).length,
    notAnAction: painted.filter(([, index]) => !indexes.has(index)).length,
  };
}

function hasFaults(faults: PaintFaults): boolean {
  return faults.missing > 0 || faults.extra > 0 || faults.notAnAction > 0;
}

function paintProblem(faults: PaintFaults): ProblemError {
  return new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.validation, {
    detail:
      `The paint must give every class of the prompt one of the node's actions: ${faults.missing} missing, ` +
      `${faults.extra} extra, ${faults.notAnAction} painted with an index that names no action.`,
  });
}

/** The paint as solver-query takes it, in the prompt's class order; a 400 problem when it does not fit. */
export function paintedHands(target: PaintTarget, paint: Readonly<Record<string, number>>): SqPaintedHand[] {
  const faults = faultsOf(target, paint);
  if (hasFaults(faults)) {
    throw paintProblem(faults);
  }
  return target.hands.map((hand) => ({ hand, action_index: paint[hand] ?? 0 }));
}
