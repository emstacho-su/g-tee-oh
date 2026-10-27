/**
 * Study routes (R3.3, A5 section 3, ADR 0004, ADR 0018): GET /study/node and GET /study/insights,
 * both relayed from solver-query; the api computes no poker number and never starts a solve.
 *
 * GET /study/node resolves the published preflop solution of (config_id, pair) through
 * solver-query's /v1/coverage (the first preflop solution id), then reads the node: node_key when
 * given (it must lie under the pair's root, else 400), otherwise the line walked from the root by
 * next_node_key (study/line-walk.ts, O-245). Rows are hand classes unless one hand is asked for.
 * The response names the next likely line and node (the largest range share), and that node is
 * prefetched in the background into this app's node cache (study/node-reader.ts), so the read that
 * usually follows reaches no solver-query node. The cache is created here, per app, never at
 * module scope, so two apps never share entries.
 */
import type { FastifyRequest } from "fastify";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { AUTHENTICATED, UPSTREAM_READ_PROBLEMS } from "../http/openapi.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError, problemResponses } from "../http/problem.js";
import {
  studyInsightsQuerySchema,
  studyInsightsSchema,
  studyNodeQuerySchema,
  studyNodeSchema,
} from "../schemas/study.js";
import {
  expectData,
  requireSolverQuery,
  upstreamHeaders,
  type SolverQuery,
  type SqNode,
} from "../solver-query/client.js";
import { appendToken, lineTokens, nextLikelyAction, rootNodeKey, walkLine } from "../study/line-walk.js";
import { toStudyInsights, toStudyNode, type NextLikely } from "../study/mapper.js";
import { createNodeCache } from "../study/node-cache.js";
import { createNodeReader, type FetchNode } from "../study/node-reader.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

const TAG = "study";
/** solver-query's hands value for the 169 class rows (O-159). */
const CLASS_HANDS = "class";
export const NO_PREFLOP_SOLUTION = "the library holds no preflop solution for this configuration and pair";

function badRequest(detail: string): ProblemError {
  return new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.badRequest, { detail });
}

/** A node_key must lie under the pair's root and replaces the line; checked before any upstream call. */
function checkNodeKey(rootKey: string, nodeKey: string | undefined, line: string | undefined): void {
  if (nodeKey === undefined) {
    return;
  }
  if (line !== undefined) {
    throw badRequest("Give a line or a node_key, not both.");
  }
  if (!nodeKey.startsWith(rootKey)) {
    throw badRequest("The node_key does not belong to this configuration and pair.");
  }
}

async function preflopSolutionId(
  sq: SolverQuery,
  request: FastifyRequest,
  configId: string,
  pair: string,
): Promise<string> {
  const coverage = await expectData(
    sq.GET("/v1/coverage", { params: { query: { config_id: configId, pair } }, headers: upstreamHeaders(request) }),
    "coverage for this configuration and pair",
  );
  const [solutionId] = coverage.preflop.solution_ids;
  if (solutionId === undefined) {
    throw new ProblemError(HTTP_STATUS.notFound, PROBLEM_SLUGS.notFound, { detail: NO_PREFLOP_SOLUTION });
  }
  return solutionId;
}

/** Where the likeliest action leads; the line is known only when the node was reached by a line or is the root. */
function nextLikely(node: Readonly<SqNode>, line: string | null): NextLikely {
  const action = nextLikelyAction(node);
  const nodeKey = action?.next_node_key ?? null;
  if (action === null || nodeKey === null) {
    return { line: null, nodeKey: null };
  }
  return { line: line === null ? null : appendToken(line, action.token), nodeKey };
}

export const studyRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, _options, done) => {
  const reader = createNodeReader(createNodeCache<SqNode>());

  app.get(
    "/study/node",
    {
      schema: {
        tags: [TAG],
        summary: "One preflop node from the library",
        security: AUTHENTICATED,
        querystring: studyNodeQuerySchema,
        response: { 200: studyNodeSchema, ...problemResponses(UPSTREAM_READ_PROBLEMS) },
      },
    },
    async (request) => {
      const sq = requireSolverQuery(app);
      const { config_id: configId, pair, line, node_key: nodeKey, hand } = request.query;
      const rootKey = rootNodeKey(configId, pair);
      checkNodeKey(rootKey, nodeKey, line);
      const solutionId = await preflopSolutionId(sq, request, configId, pair);
      const hands = hand ?? CLASS_HANDS;
      const fetchNode: FetchNode = (target) =>
        expectData(
          sq.GET("/v1/nodes", {
            params: { query: { solution_id: target.solutionId, node_key: target.nodeKey, hands: target.hands } },
            headers: upstreamHeaders(request),
          }),
          "this node",
        );
      const readNode = (key: string) => reader.read({ solutionId, nodeKey: key, hands }, fetchNode);
      const node = nodeKey === undefined ? await walkLine(rootKey, lineTokens(line), readNode) : await readNode(nodeKey);
      const knownLine = nodeKey === undefined ? (line ?? "") : nodeKey === rootKey ? "" : null;
      const next = nextLikely(node, knownLine);
      if (next.nodeKey !== null) {
        void reader.prefetch({ solutionId, nodeKey: next.nodeKey, hands }, fetchNode, (context, message) =>
          request.log.warn(context, message),
        );
      }
      return toStudyNode(node, next);
    },
  );

  app.get(
    "/study/insights",
    {
      schema: {
        tags: [TAG],
        summary: "Insight data for a hand at a node",
        security: AUTHENTICATED,
        querystring: studyInsightsQuerySchema,
        response: { 200: studyInsightsSchema, ...problemResponses(UPSTREAM_READ_PROBLEMS) },
      },
    },
    async (request) => {
      const sq = requireSolverQuery(app);
      const { solution_id, node_key, hand } = request.query;
      const insights = await expectData(
        sq.GET("/v1/insights", { params: { query: { solution_id, node_key, hand } }, headers: upstreamHeaders(request) }),
        "insights for this hand at this node",
      );
      return toStudyInsights(insights);
    },
  );

  done();
};
