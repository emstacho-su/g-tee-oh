/**
 * A fake EventSource for the mock project and the shots (S28, R3.4, O-297). page.route can only
 * answer a request with a whole body, so a real EventSource would see each mocked stream end and
 * reconnect; this fake stays open and lets a test push an event when it chooses.
 *
 * Mechanism: installFakeEventSource replaces window.EventSource before any page script runs. Each
 * instance opens on the next tick (an "open" event, readyState 1) and keeps its listeners;
 * emitServerEvent calls window.__gtoEmitServerEvent(name, data) in the page, which hands a
 * MessageEvent with that data to every open instance's listeners for that name. Nothing touches
 * the network.
 */
import type { Page } from "@playwright/test";

const EMIT_FUNCTION = "__gtoEmitServerEvent";

export async function installFakeEventSource(page: Page): Promise<void> {
  await page.addInitScript((emitName) => {
    type Listener = (event: MessageEvent<string>) => void;
    const open: FakeEventSource[] = [];
    class FakeEventSource {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readyState = 0;
      readonly url: string;
      private readonly listeners = new Map<string, Listener[]>();
      constructor(url: string) {
        this.url = url;
        open.push(this);
        setTimeout(() => {
          if (this.readyState === 2) return;
          this.readyState = 1;
          this.dispatch("open", "");
        }, 0);
      }
      addEventListener(type: string, listener: Listener): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
      }
      close(): void {
        this.readyState = 2;
        open.splice(open.indexOf(this), 1);
      }
      dispatch(type: string, data: string): void {
        for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data }));
      }
    }
    Object.assign(window, {
      EventSource: FakeEventSource,
      [emitName]: (type: string, data: string) => {
        for (const source of [...open]) if (source.readyState === 1) source.dispatch(type, data);
      },
    });
  }, EMIT_FUNCTION);
}

/** Sends one named event with a JSON payload to every open stream on the page. */
export async function emitServerEvent(page: Page, name: string, payload: unknown): Promise<void> {
  await page.evaluate(
    ([emitName, eventName, data]) => {
      const emit = (window as unknown as Record<string, (type: string, value: string) => void>)[emitName];
      if (emit === undefined) throw new Error("the fake EventSource is not installed");
      emit(eventName, data);
    },
    [EMIT_FUNCTION, name, JSON.stringify(payload)] as const,
  );
}
