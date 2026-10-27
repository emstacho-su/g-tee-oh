/**
 * Admin builder routes (R3.5, O-36, O-88, O-188, O-241, O-242): GET /admin/builder, PATCH
 * /admin/builder/settings, POST /admin/builder/pause and POST /admin/builder/resume.
 *
 * Mechanism: an onRequest hook scoped to this plugin runs after the app's authentication and CSRF
 * hooks and requires app_user.is_admin (requireAdmin, a 403 forbidden problem otherwise), so a
 * non-admin is refused before the body is parsed or validated and no route here can forget the
 * check. The three writes keep the default CSRF token check and accept an Idempotency-Key; each
 * upserts builder_setting rows in one transaction through idempotentWrite (insert on conflict
 * update: the app role has insert and update but no delete, O-241), and the response is read
 * inside the same transaction, so a replay returns exactly what was stored. The api never talks to
 * the builder: the builder reads builder_setting on every claim, so a change takes effect on its
 * next job, and it reports its own semantic checks of a value on its health probe (O-188). The
 * state shown comes from the event hub's last builder_state (O-243).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { readBuilderStatus, readStoredSettings, upsertSettings, type BuilderStatus } from "../admin/builder-status.js";
import { requireAdmin } from "../admin/require-admin.js";
import { PAUSED_KEY } from "../admin/settings-keys.js";
import { eventHub } from "../events/registry.js";
import { requireDatabase } from "../http/database.js";
import { mutatingHeadersSchema } from "../http/headers.js";
import { idempotentWrite } from "../http/idempotent-write.js";
import { ADMIN_MUTATE_PROBLEMS, ADMIN_READ_PROBLEMS, AUTHENTICATED } from "../http/openapi.js";
import { HTTP_STATUS, problemResponses } from "../http/problem.js";
import { builderSettingsPatchSchema, builderSettingsSchema, builderStatusSchema } from "../schemas/insights.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

const TAG = "admin";

/**
 * Pause and resume take no body. Fastify hands a bodiless POST to validation as null, which the
 * shared emptyBodySchema (optional, not nullable) refuses, so these routes accept null as well.
 */
const noBodySchema = z.strictObject({}).nullable().optional();

function setPaused(app: FastifyInstance, request: FastifyRequest, paused: boolean): Promise<BuilderStatus> {
  return idempotentWrite(app, request, HTTP_STATUS.ok, async (transaction): Promise<BuilderStatus> => {
    await upsertSettings(transaction, { [PAUSED_KEY]: paused });
    return readBuilderStatus(transaction, eventHub(app).lastBuilderState());
  });
}

function pauseSchema(summary: string) {
  return {
    tags: [TAG],
    summary,
    security: AUTHENTICATED,
    headers: mutatingHeadersSchema,
    body: noBodySchema,
    response: { 200: builderStatusSchema, ...problemResponses(ADMIN_MUTATE_PROBLEMS) },
  };
}

export const adminRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, _options, done) => {
  app.addHook("onRequest", async (request) => {
    await requireAdmin(app, request);
  });

  app.get(
    "/admin/builder",
    {
      schema: {
        tags: [TAG],
        summary: "Builder queue, throughput, storage and settings",
        security: AUTHENTICATED,
        response: { 200: builderStatusSchema, ...problemResponses(ADMIN_READ_PROBLEMS) },
      },
    },
    async () => readBuilderStatus(requireDatabase(app), eventHub(app).lastBuilderState()),
  );

  app.patch(
    "/admin/builder/settings",
    {
      schema: {
        tags: [TAG],
        summary: "Change builder settings; returns every stored override",
        security: AUTHENTICATED,
        headers: mutatingHeadersSchema,
        body: builderSettingsPatchSchema,
        response: { 200: builderSettingsSchema, ...problemResponses(ADMIN_MUTATE_PROBLEMS) },
      },
    },
    async (request) =>
      idempotentWrite(app, request, HTTP_STATUS.ok, async (transaction) => {
        await upsertSettings(transaction, request.body);
        return { settings: await readStoredSettings(transaction) };
      }),
  );

  app.post("/admin/builder/pause", { schema: pauseSchema("Pause the builder") }, async (request) =>
    setPaused(app, request, true),
  );

  app.post("/admin/builder/resume", { schema: pauseSchema("Resume the builder") }, async (request) =>
    setPaused(app, request, false),
  );

  done();
};
