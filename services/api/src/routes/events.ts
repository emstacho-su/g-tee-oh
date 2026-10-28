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
 * its connection closes or fails; the close and error listeners are attached before the admin
 * lookup awaits, and a client that left during that lookup gets no stream (PR #25 review H2).
 *
 * After the open (PR #25 review L2): each stream carries its session id and a recheck
 * (events/stream-check.ts) that the hub runs at every heartbeat, ending the stream when the
 * session has expired or was deleted and following the current admin flag; the hub also ends a
 * stream at the first heartbeat past MAX_STREAM_LIFETIME_MS, and logout ends the session's streams
 * at once (routes/auth.ts).
 */
import type { OutgoingHttpHeaders } from "node:http";

import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { isAdmin } from "../admin/require-admin.js";
import { type EventStream, MAX_STREAMS_PER_USER } from "../events/hub.js";
import { eventHub } from "../events/registry.js";
import { sessionStreamCheck } from "../events/stream-check.js";
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
    // A stream the server ends (logout, an ended session, the lifetime cap) closes its connection
    // rather than leaving it to keep-alive, so shutdown never waits on it (PR #25 review L2).
    connection: "close",
    [REQUEST_ID_HEADER]: request.id,
  };
}

interface WatchedConnection {
  /** True once the client's connection closed or failed. */
  gone(): boolean;
  /** Unregisters the stream when the connection closes or fails (at once if it already has). */
  attach(stream: EventStream): void;
}

/**
 * Watches the response for close and error from before the handler's first await, so neither
 * event can be missed between the lookup and the registration.
 */
function watchConnection(request: FastifyRequest, reply: FastifyReply): WatchedConnection {
  let closed = false;
  let stream: EventStream | null = null;
  const release = (): void => {
    closed = true;
    stream?.close();
  };
  reply.raw.on("close", release);
  reply.raw.on("error", (error) => {
    request.log.warn({ err: error }, "event stream failed");
    release();
  });
  return {
    gone: () => closed || reply.raw.destroyed || request.raw.socket.destroyed,
    attach: (opened) => {
      stream = opened;
      if (closed) {
        opened.close();
      }
    },
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
      const { userId, sessionId } = requireSession(request);
      const database = requireDatabase(app);
      // Attached before the first await (PR #25 review H2), so a client that leaves during the
      // admin lookup is seen and never gets a stream registered that nothing would unregister.
      const connection = watchConnection(request, reply);
      const admin = await isAdmin(database, userId);
      if (connection.gone()) {
        request.log.info("event stream client left before the stream opened");
        reply.hijack();
        reply.raw.destroy();
        return reply;
      }
      if (!hub.hasRoom(userId)) {
        throw tooManyStreams();
      }
      reply.hijack();
      reply.raw.writeHead(HTTP_STATUS.ok, streamHeaders(request, reply));
      const recheck = sessionStreamCheck(database, sessionId);
      connection.attach(hub.open({ userId, sessionId, isAdmin: admin, sink: reply.raw, recheck }));
      return reply;
    },
  );

  done();
};
