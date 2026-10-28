/**
 * One event hub per app (R3.4, R3.5, O-243). The events routes stream from it and GET
 * /admin/builder reads its last builder_state, but the two route plugins are separate Fastify
 * encapsulation contexts, so a decoration made in one is not visible in the other. Every context
 * of one app shares the same Node server object, so the hub is kept in a WeakMap keyed by it and
 * created on first use from app.notifications (null gives a hub that sends heartbeats only).
 */
import type { Server } from "node:http";

import type { FastifyInstance } from "fastify";

import { EventHub, type HubOptions } from "./hub.js";

const hubs = new WeakMap<Server, EventHub>();

/** The app's hub, created on first call. */
export function eventHub(app: FastifyInstance, options: Partial<HubOptions> = {}): EventHub {
  const existing = hubs.get(app.server);
  if (existing !== undefined) {
    return existing;
  }
  const created = new EventHub(app.notifications, app.log, options);
  hubs.set(app.server, created);
  return created;
}
