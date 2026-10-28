/**
 * Coverage routes (R3.4, A5 section 3, ADR 0018, O-172, O-240): GET /coverage relays what the
 * library holds for a configuration and pair from solver-query, the single source; POST
 * /coverage/requests asks for an uncovered spot and answers 202 with what it did (status queued,
 * blocked_budget, recorded or covered; study/coverage-requests.ts). Neither ever starts a solve.
 *
 * Both routes read solver-query's /v1/coverage through readCoverage, the one coverage read in this
 * module (PR #25 review L12). The POST reads it before its transaction, so no database transaction
 * waits on the network; the write and, under an Idempotency-Key, its stored response then commit
 * together through idempotentWrite (O-232), so a replay answers the first body and raises nothing
 * twice. A covered spot writes nothing but still answers through the same path, so its replay is
 * the same body too.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { mutatingHeadersSchema } from "../http/headers.js";
import { idempotentWrite } from "../http/idempotent-write.js";
import { AUTHENTICATED, UPSTREAM_MUTATE_PROBLEMS, UPSTREAM_READ_PROBLEMS } from "../http/openapi.js";
import { HTTP_STATUS, problemResponses } from "../http/problem.js";
import { requireSession } from "../plugins/authenticate.js";
import {
  coverageQuerySchema,
  coverageRequestBodySchema,
  coverageRequestResultSchema,
  coverageSchema,
} from "../schemas/study.js";
import { expectData, requireSolverQuery, type SqCoverage, upstreamHeaders } from "../solver-query/client.js";
// The coverage helpers live under study/ because .gitignore and the eslint config ignore every
// directory named coverage (the test coverage output).
import { isSpotCovered, toCoverage } from "../study/coverage-mapper.js";
import { COVERED, requestCoverage } from "../study/coverage-requests.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

const TAG = "coverage";
const COVERAGE_WHAT = "coverage for this configuration and pair";

/** solver-query's coverage of one configuration and pair, with its problems mapped (expectData). */
function readCoverage(app: FastifyInstance, request: FastifyRequest, configId: string, pair: string): Promise<SqCoverage> {
  return expectData(
    requireSolverQuery(app).GET("/v1/coverage", {
      params: { query: { config_id: configId, pair } },
      headers: upstreamHeaders(request),
    }),
    COVERAGE_WHAT,
  );
}

export const coverageRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, _options, done) => {
  app.get(
    "/coverage",
    {
      schema: {
        tags: [TAG],
        summary: "What the library holds for a configuration and pair",
        security: AUTHENTICATED,
        querystring: coverageQuerySchema,
        response: { 200: coverageSchema, ...problemResponses(UPSTREAM_READ_PROBLEMS) },
      },
    },
    async (request) => {
      const { config_id: configId, pair } = request.query;
      return toCoverage(await readCoverage(app, request, configId, pair));
    },
  );

  app.post(
    "/coverage/requests",
    {
      schema: {
        tags: [TAG],
        summary: "Raise a build's priority for an uncovered spot or record the request; never starts a solve (ADR 0018)",
        security: AUTHENTICATED,
        headers: mutatingHeadersSchema,
        body: coverageRequestBodySchema,
        response: { 202: coverageRequestResultSchema, ...problemResponses(UPSTREAM_MUTATE_PROBLEMS) },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);
      const { config_id: configId, pair, flop, line } = request.body;
      const covered = isSpotCovered(await readCoverage(app, request, configId, pair), flop);
      const result = await idempotentWrite(app, request, HTTP_STATUS.accepted, async (transaction) =>
        covered ? COVERED : requestCoverage(transaction, { userId, configId, pair, flop, line }),
      );
      return reply.code(HTTP_STATUS.accepted).send(result);
    },
  );

  done();
};
