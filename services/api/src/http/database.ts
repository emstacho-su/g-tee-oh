/**
 * Access to the database handle from a request (R3.1). buildApp decorates the app with the
 * Kysely handle it was given, or null when it was built without one (the OpenAPI export, unit
 * tests of the HTTP layer). A handler that needs the database calls requireDatabase, which turns
 * a missing handle into a 503 problem instead of a crash.
 */
import "fastify";
import type { FastifyInstance } from "fastify";

import type { Database } from "../db.js";
import { PROBLEM_SLUGS, ProblemError } from "./problem.js";

declare module "fastify" {
  interface FastifyInstance {
    database: Database | null;
  }
}

const UNAVAILABLE_STATUS = 503;

export function requireDatabase(app: FastifyInstance): Database {
  if (app.database === null) {
    throw new ProblemError(UNAVAILABLE_STATUS, PROBLEM_SLUGS.unavailable, {
      detail: "The database is not configured.",
    });
  }
  return app.database;
}
