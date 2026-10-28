/**
 * Walking a preflop line through the solution tree (R3.3, O-245, ADR 0004).
 *
 * The api composes exactly one node key, the pair's root `<config_id>/<pair>/`, pinned to the
 * text gto-model's crates/gto-model/tests/keys_and_tokens.rs asserts for cfg_6_online_100/BB-BTN/.
 * Every other node is reached through the next_node_key solver-query puts on each action, so the
 * api never needs the node-key grammar or any poker rule to find a child. A line is the
 * dot-separated token list lineSchema (schemas/common.ts) accepts; each token must be one the
 * current node offers, and an action whose next_node_key is null ends the solution, so a token
 * after it is a 404 problem.
 *
 * The next likely action is the one with the largest range share solver-query reports in
 * range_summary.by_action (lowest index on a tie); the api compares the shares it was given and
 * computes none (ADR 0004).
 */
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import type { SqAction, SqNode } from "../solver-query/client.js";

/** The separator between the tokens of a line (LINE_PATTERN in schemas/common.ts). */
export const LINE_SEPARATOR = ".";

/** The root node key of a configuration and pair (O-245), the only key the api composes. */
export function rootNodeKey(configId: string, pair: string): string {
  return `${configId}/${pair}/`;
}

/** The tokens of a line; the root has none. */
export function lineTokens(line: string | undefined): readonly string[] {
  return line === undefined || line === "" ? [] : line.split(LINE_SEPARATOR);
}

/** The line one token further down. */
export function appendToken(line: string | undefined, token: string): string {
  return line === undefined || line === "" ? token : `${line}${LINE_SEPARATOR}${token}`;
}

function notFound(detail: string): ProblemError {
  return new ProblemError(HTTP_STATUS.notFound, PROBLEM_SLUGS.notFound, { detail });
}

/** The child key the action leads to, or a 404 problem when the token ends or leaves the tree. */
function childKey(node: Readonly<SqNode>, token: string): string {
  const action = node.actions.find((candidate) => candidate.token === token);
  if (action === undefined) {
    throw notFound(`The node does not offer the action ${token}.`);
  }
  const next = action.next_node_key ?? null;
  if (next === null) {
    throw notFound(`The action ${token} ends the solution; the line cannot continue past it.`);
  }
  return next;
}

/**
 * Reads the node the tokens lead to from the root, one solver-query node read per step (each
 * through the read-through cache), and returns the last node read.
 */
export async function walkLine(
  rootKey: string,
  tokens: readonly string[],
  readNode: (nodeKey: string) => Promise<Readonly<SqNode>>,
): Promise<Readonly<SqNode>> {
  let node = await readNode(rootKey);
  for (const token of tokens) {
    node = await readNode(childKey(node, token));
  }
  return node;
}

/** The action with the largest range share at the node, or null when the node lists none. */
export function nextLikelyAction(node: Pick<Readonly<SqNode>, "actions" | "range_summary">): Readonly<SqAction> | null {
  let best: { index: number; share: number } | null = null;
  for (const entry of node.range_summary.by_action) {
    if (best === null || entry.share > best.share || (entry.share === best.share && entry.index < best.index)) {
      best = entry;
    }
  }
  if (best === null) {
    return null;
  }
  const chosen = best;
  return node.actions.find((action) => action.index === chosen.index) ?? null;
}
