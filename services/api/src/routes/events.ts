/**
 * Server-sent events (R3.4, A4 section 4, O-243): GET /events streams coverage_added and
 * builder_state to every signed-in user and build_progress to admins, from the app's event hub
 * (events/hub.ts), which this plugin creates at registration from app.notifications (null gives
 * heartbeats only) and closes when the app closes.
 *
 * Mechanism: the route needs a session (the default auth policy). It refuses a user's fifth open
 * stream with a 429 too-many-streams problem before it takes the response over, so the refusal is
 * an ordinary problem response. Then it hijacks the reply and writes the head itself on reply.raw:
 * a hijacked reply skips Fastify's onSend hooks, so the head carries what they would have added
 * (x-request-id and cache-control no-store) plus the headers already set on the reply (helmet's
 * security headers, CORS), the event-stream content type and x-accel-buffering no, which tells a
 * buffering proxy to pass each event through at once. The check and the registration are
 * synchronous, so two requests cannot both take the last slot. The stream is unregistered when
 * its connection closes or fails.
 */
import type { OutgoingHttpHeaders } from "node:http";

import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { isAdmin } from "../admin/require-admin.js";
import { MAX_STREAMS_PER_USER } from "../events/hub.js";
import { eventHub } from "../events/registry.js";
import { requireDatabase } from "../http/database.js";
import { REQUEST_ID_HEADER } from "../http/headers.js";
import { AUTHENTICATED, READ_PROBLEMS } from "../http/openapi.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError, problemResponses } from "../http/problem.js";
import { requireSession } from "../plugins/authenticate.js";
import { eventStreamSchema } from "../schemas/insights.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

const TAG = "events";
const EVENT_STREAM_TYPE = "text/event-stream";

type HeaderValues = Record<string, string | string[]>;

/** The headers already set on the reply, with numbers as text and unset ones left out. */
function replyHeaders(reply: FastifyReply): HeaderValues {
  const entries = Object.entries(reply.getHeaders()).flatMap(([name, value]): [string, string | string[]][] => {
    if (value === undefined) {
      return [];
    }
    return [[name, typeof value === "number" ? String(value) : value]];
  });
  return Object.fromEntries(entries);
}

/** The head of a hijacked event stream. */
export function streamHeaders(request: FastifyRequest, reply: FastifyReply): OutgoingHttpHeaders {
  return {
    ...replyHeaders(reply),
    "content-type": `${EVENT_STREAM_TYPE}; charset=utf-8`,
    "cache-control": "no-store",
    "x-accel-buffering": "no",
    [REQUEST_ID_HEADER]: request.id,
  };
}

function tooManyStreams(): ProblemError {
  return new ProblemError(HTTP_STATUS.tooManyRequests, PROBLEM_SLUGS.tooManyStreams, {
    detail: `At most ${MAX_STREAMS_PER_USER} event streams may be open per user; close one first.`,
  });
}

export const eventRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, _options, done) => {
  const hub = eventHub(app);
  app.addHook("preClose", (finished) => {
    hub.close();
    finished();
  });

  app.get(
    "/events",
    {
      // A HEAD request would run this handler and hold a stream slot open with no body to read.
      exposeHeadRoute: false,
      schema: {
        tags: [TAG],
        summary: "Server-sent events: coverage_added and builder_state, and build_progress for admins",
        security: AUTHENTICATED,
        response: {
          200: {
            description: "The event stream",
            content: { [EVENT_STREAM_TYPE]: { schema: eventStreamSchema } },
          },
          ...problemResponses(READ_PROBLEMS),
        },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);
      const admin = await isAdmin(requireDatabase(app), userId);
      if (!hub.hasRoom(userId)) {
        throw tooManyStreams();
      }
      reply.hijack();
      reply.raw.writeHead(HTTP_STATUS.ok, streamHeaders(request, reply));
      const stream = hub.open({ userId, isAdmin: admin, sink: reply.raw });
      reply.raw.on("close", () => {
        stream.close();
      });
      reply.raw.on("error", (error) => {
        request.log.warn({ err: error }, "event stream failed");
        stream.close();
      });
      return reply;
    },
  );

  done();
};
